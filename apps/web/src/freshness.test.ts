import { describe, expect, it } from "vitest";
import { REFRESH_INTERVAL_MS, shouldRefresh, updatedAgo } from "./freshness";

describe("shouldRefresh", () => {
  it("refetches only for a visible page with no fetch in flight", () => {
    expect(shouldRefresh({ visible: true, pending: false })).toBe(true);
    expect(shouldRefresh({ visible: false, pending: false })).toBe(false);
    expect(shouldRefresh({ visible: true, pending: true })).toBe(false);
  });
  it("waits fifteen seconds between refetches", () => {
    expect(REFRESH_INTERVAL_MS).toBe(15_000);
  });
});

describe("updatedAgo", () => {
  it("counts seconds under a minute and minutes after", () => {
    expect(updatedAgo(0)).toBe("Updated 0 s ago");
    expect(updatedAgo(12_400)).toBe("Updated 12 s ago");
    expect(updatedAgo(61_000)).toBe("Updated 1 min ago");
    expect(updatedAgo(-5)).toBe("Updated 0 s ago");
  });
});
