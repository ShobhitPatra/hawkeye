import { describe, expect, it } from "vitest";
import { alreadyReviewed } from "./idempotency.js";

const sha = "a".repeat(40);
describe("alreadyReviewed", () => {
  it("is true when the bot posted a marker for this head", () => {
    expect(
      alreadyReviewed(
        [{ authorLogin: "hawkeye-review[bot]", body: `<!-- hawkeye: head=${sha} -->\nhi` }],
        sha,
        "hawkeye-review[bot]",
      ),
    ).toBe(true);
  });
  it("is false for another head, another author, or no marker", () => {
    expect(
      alreadyReviewed(
        [{ authorLogin: "hawkeye-review[bot]", body: `<!-- hawkeye: head=${"b".repeat(40)} -->` }],
        sha,
        "hawkeye-review[bot]",
      ),
    ).toBe(false);
    expect(
      alreadyReviewed(
        [{ authorLogin: "alice", body: `<!-- hawkeye: head=${sha} -->` }],
        sha,
        "hawkeye-review[bot]",
      ),
    ).toBe(false);
    expect(
      alreadyReviewed(
        [{ authorLogin: "hawkeye-review[bot]", body: "plain" }],
        sha,
        "hawkeye-review[bot]",
      ),
    ).toBe(false);
    expect(alreadyReviewed([], sha, "hawkeye-review[bot]")).toBe(false);
  });
});
