import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatError,
  formatFindingLocation,
  formatVerdict,
  shortSha,
} from "./run-format";

describe("run formatting", () => {
  it("shortens shas to seven characters", () => {
    expect(shortSha("abcdef0123456789")).toBe("abcdef0");
  });
  it("renders the verdict with the reported one only when it differs", () => {
    expect(formatVerdict({})).toBe("");
    expect(formatVerdict({ verdict: "changes_needed", reportedVerdict: "changes_needed" })).toBe(
      "Changes needed",
    );
    expect(formatVerdict({ verdict: "ship", reportedVerdict: "blocked" })).toBe(
      "Ship (reported Blocked)",
    );
  });
  it("renders durations in minutes and seconds", () => {
    const startedAt = new Date("2026-01-01T10:00:00.000Z");
    expect(formatDuration({ startedAt })).toBe("");
    expect(formatDuration({ startedAt, endedAt: new Date("2026-01-01T10:00:42.000Z") })).toBe(
      "42s",
    );
    expect(formatDuration({ startedAt, endedAt: new Date("2026-01-01T10:04:32.000Z") })).toBe(
      "4m 32s",
    );
  });
  it("truncates long errors", () => {
    expect(formatError(undefined)).toBe("");
    expect(formatError("x".repeat(121))).toBe(`${"x".repeat(120)}…`);
  });
  it("renders a finding location only when a path exists", () => {
    expect(formatFindingLocation({ path: null, line: null })).toBe("");
    expect(formatFindingLocation({ path: "a.ts", line: null })).toBe(" (a.ts)");
    expect(formatFindingLocation({ path: "a.ts", line: 3 })).toBe(" (a.ts:3)");
  });
});
