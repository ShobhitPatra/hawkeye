import { describe, expect, it, vi } from "vitest";
import { hold, type HoldStore } from "./hold";

describe("hold", () => {
  it("reuses a value within its time and produces again after", async () => {
    const store: HoldStore<number> = new Map();
    const produce = vi.fn(async () => 1);
    await hold(store, "a", { now: 0, ttlMs: 60_000 }, produce);
    await hold(store, "a", { now: 59_000, ttlMs: 60_000 }, produce);
    expect(produce).toHaveBeenCalledTimes(1);
    await hold(store, "a", { now: 60_000, ttlMs: 60_000 }, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
  it("lets the value shorten its own time", async () => {
    const store: HoldStore<string> = new Map();
    const produce = vi.fn(async () => "partial");
    const shorter = {
      now: 0,
      ttlMs: 60_000,
      ttlAfter: (value: string) => (value === "partial" ? 15_000 : 60_000),
    };
    await hold(store, "a", shorter, produce);
    await hold(store, "a", { ...shorter, now: 14_000 }, produce);
    await hold(store, "a", { ...shorter, now: 16_000 }, produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });
  it("forgets a rejected value, and only its own entry", async () => {
    const store: HoldStore<number> = new Map();
    let fail: ((error: Error) => void) | undefined;
    const slow = new Promise<number>((_, reject) => {
      fail = reject;
    });
    const first = hold(store, "a", { now: 0, ttlMs: 1_000 }, () => slow);
    await hold(store, "a", { now: 2_000, ttlMs: 1_000 }, async () => 2);
    fail?.(new Error("late"));
    await expect(first).rejects.toThrow("late");
    expect(store.get("a")).toBeDefined();
    expect(await store.get("a")!.value).toBe(2);
  });
  it("evicts entries whose time has passed when a new one is stored", async () => {
    const store: HoldStore<number> = new Map();
    await hold(store, "a", { now: 0, ttlMs: 1_000 }, async () => 1);
    await hold(store, "b", { now: 5_000, ttlMs: 1_000 }, async () => 2);
    expect([...store.keys()]).toEqual(["b"]);
  });
  it("rejects a time that is not positive", () => {
    expect(() => hold(new Map(), "a", { now: 0, ttlMs: 0 }, async () => 1)).toThrow(
      "ttlMs must be positive",
    );
  });
});
