import { describe, expect, it } from "vitest";
import { findingId } from "./finding-id.js";

describe("findingId", () => {
  it("is stable across whitespace, case and trailing punctuation", () => {
    expect(findingId("src/a.ts", "Missing null check.")).toBe(
      findingId("src/a.ts", "  missing   NULL check"),
    );
  });
  it("differs by path", () => {
    expect(findingId("a.ts", "x")).not.toBe(findingId("b.ts", "x"));
  });
  it("is 12 hex chars", () => {
    expect(findingId(undefined, "claim")).toMatch(/^[0-9a-f]{12}$/);
  });
});
