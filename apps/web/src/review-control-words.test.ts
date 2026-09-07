import { describe, expect, it } from "vitest";
import { reviewControlWords } from "./review-control-words";

describe("reviewControlWords", () => {
  it("names the state, what a click does, and the moment in between", () => {
    expect(reviewControlWords({ reviewing: true, pending: false })).toEqual({
      word: "Reviewing",
      next: "Pause",
      pending: false,
    });
    expect(reviewControlWords({ reviewing: false, pending: false })).toEqual({
      word: "Review",
      next: "Review",
      pending: false,
    });
    expect(reviewControlWords({ reviewing: true, pending: true })).toMatchObject({
      word: "Starting",
      pending: true,
    });
    expect(reviewControlWords({ reviewing: false, pending: true })).toMatchObject({
      word: "Pausing",
      pending: true,
    });
  });
});
