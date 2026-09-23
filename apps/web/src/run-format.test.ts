import { describe, expect, it } from "vitest";
import { formatDuration, formatError, postingNote, runFailureLabel, shortSha } from "./run-format";

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
  it("reads a posting note off a run that posted", () => {
    expect(
      postingNote("post: GitHub refused the full review (422 too long); the short form was posted"),
    ).toEqual({ kind: "short-form", detail: "GitHub refused the full review (422 too long)" });
    expect(postingNote("post: GitHub POST /repos/o/r/pulls/1/reviews failed: 502")).toEqual({
      kind: "not-posted",
      detail: "GitHub POST /repos/o/r/pulls/1/reviews failed: 502",
    });
    expect(postingNote("claude exited with 1")).toBeUndefined();
    expect(postingNote(undefined)).toBeUndefined();
  });

  it("truncates long errors", () => {
    expect(formatError(undefined)).toBe("");
    expect(formatError("x".repeat(121))).toBe(`${"x".repeat(120)}…`);
  });
});
