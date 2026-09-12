import { describe, expect, it } from "vitest";
import { formatDuration, formatError, runFailureLabel, shortSha } from "./run-format";

describe("run formatting", () => {
  it("shortens shas to seven characters", () => {
    expect(shortSha("abcdef0123456789")).toBe("abcdef0");
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
  it("names every failure status in plain words and refuses the others", () => {
    expect(runFailureLabel("timeout")).toBe("ran out of time");
    expect(runFailureLabel("superseded")).toBe("was superseded by a newer push");
    expect(runFailureLabel("invalid-output")).toBe("returned a result Hawkeye could not read");
    expect(() => runFailureLabel("ok")).toThrow();
  });
  it("truncates long errors", () => {
    expect(formatError(undefined)).toBe("");
    expect(formatError("x".repeat(121))).toBe(`${"x".repeat(120)}…`);
  });
});
