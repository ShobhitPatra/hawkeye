import { describe, expect, it } from "vitest";
import { failedPostNote, postingNote, shortFormNote } from "./posting-note";

describe("postingNote", () => {
  it("reads back what the short form writer wrote", () => {
    expect(postingNote(shortFormNote("GitHub PUT failed: 422 too long"))).toEqual({
      kind: "short-form",
      detail: "GitHub PUT failed: 422 too long",
    });
  });
  it("reads back what the failed post writer wrote", () => {
    expect(postingNote(failedPostNote("GitHub POST failed: 502"))).toEqual({
      kind: "not-posted",
      detail: "GitHub POST failed: 502",
    });
  });
  it("reads nothing off a run error", () => {
    expect(postingNote("claude exited with 1")).toBeUndefined();
    expect(postingNote(undefined)).toBeUndefined();
  });
});
