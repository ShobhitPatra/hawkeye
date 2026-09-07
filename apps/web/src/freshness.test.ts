import { describe, expect, it } from "vitest";
import { shouldRefresh } from "./freshness";

describe("shouldRefresh", () => {
  it("refetches only for a visible page with no fetch in flight and none just started", () => {
    expect(shouldRefresh({ visible: true, pending: false, sinceLastStartMs: 15_000 })).toBe(true);
    expect(shouldRefresh({ visible: false, pending: false, sinceLastStartMs: 15_000 })).toBe(false);
    expect(shouldRefresh({ visible: true, pending: true, sinceLastStartMs: 15_000 })).toBe(false);
    expect(shouldRefresh({ visible: true, pending: false, sinceLastStartMs: 200 })).toBe(false);
  });
});
