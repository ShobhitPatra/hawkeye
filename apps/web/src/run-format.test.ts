import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatError,
  planLimitNote,
  runFailureLabel,
  runPlanLimit,
  shortSha,
} from "./run-format";

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
  it("names a plan limit instead of a harness failure", () => {
    expect(runFailureLabel("error", "claude exited with 1: You've hit your session limit")).toBe(
      "hit the plan's usage limit",
    );
    expect(runFailureLabel("error", "codex exited with 1: Selected model is at capacity.")).toBe(
      "the model was at capacity",
    );
    expect(runFailureLabel("error", "codex exited with 1: boom")).toBe("the harness failed");
    expect(runFailureLabel("error")).toBe("the harness failed");
  });
  it("reads a plan limit only from a run that errored", () => {
    expect(runPlanLimit("error", "API Error: 429")).toBe("rate limit");
    expect(runPlanLimit("timeout", "API Error: 429")).toBeUndefined();
    expect(runPlanLimit("error", null)).toBeUndefined();
    expect(planLimitNote("rate limit")).toBe("Usage limit");
    expect(planLimitNote("overload")).toBe("Model at capacity");
  });
  it("truncates long errors", () => {
    expect(formatError(undefined)).toBe("");
    expect(formatError("x".repeat(121))).toBe(`${"x".repeat(120)}…`);
  });
});
