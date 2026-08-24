import { describe, expect, it, vi } from "vitest";
import { LENSES } from "../contract/schema.js";
import { GitHubRequestError } from "../github/client.js";
import { postRenderedReview } from "./post.js";
import { renderReview } from "./render.js";

const reference = { owner: "o", repo: "r", number: 1 };
const headSha = "a".repeat(40);
const result = {
  verdict: "revise" as const,
  summary: "s",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [{ path: "a.txt", line: 2, severity: "should_fix" as const, claim: "c", detail: "d" }],
};
const render = (commentable: Map<string, Set<number>>) =>
  renderReview({ result, headSha, commentable, repositoryUrl: "https://example.test" });
const commentable = new Map([["a.txt", new Set([2])]]);
const posted = { url: "https://github.com/o/r/pull/1#pullrequestreview-9", id: "9" };

describe("postRenderedReview", () => {
  it("posts the review with inline anchors", async () => {
    const postReview = vi.fn(async () => posted);
    const log = vi.fn();
    const outcome = await postRenderedReview({
      github: { postReview },
      reference,
      token: "t",
      render,
      commentable,
      log,
    });
    expect(outcome.posted).toEqual(posted);
    expect(outcome.review.comments).toHaveLength(1);
    expect(postReview).toHaveBeenCalledWith(reference, outcome.review, "t");
    expect(log).not.toHaveBeenCalled();
  });
  it("retries body-only when GitHub rejects the anchors with 422", async () => {
    const postReview = vi
      .fn()
      .mockRejectedValueOnce(new GitHubRequestError(422, "failed: 422"))
      .mockResolvedValueOnce(posted);
    const log = vi.fn();
    const outcome = await postRenderedReview({
      github: { postReview },
      reference,
      token: "t",
      render,
      commentable,
      log,
    });
    expect(postReview).toHaveBeenCalledTimes(2);
    expect(outcome.review.comments).toEqual([]);
    expect(outcome.review.body).toContain("**c**");
    expect(log).toHaveBeenCalledWith("inline anchors rejected (422); posting body only");
  });
  it("does not retry a 422 when there were no inline anchors", async () => {
    const postReview = vi.fn().mockRejectedValue(new GitHubRequestError(422, "failed: 422"));
    await expect(
      postRenderedReview({
        github: { postReview },
        reference,
        token: "t",
        render,
        commentable: new Map(),
        log: vi.fn(),
      }),
    ).rejects.toThrow(/422/);
    expect(postReview).toHaveBeenCalledTimes(1);
  });
  it("propagates other failures without retrying", async () => {
    const postReview = vi.fn().mockRejectedValue(new GitHubRequestError(500, "failed: 500"));
    await expect(
      postRenderedReview({
        github: { postReview },
        reference,
        token: "t",
        render,
        commentable,
        log: vi.fn(),
      }),
    ).rejects.toThrow(/500/);
    expect(postReview).toHaveBeenCalledTimes(1);
  });
});
