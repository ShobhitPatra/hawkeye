import type { GitHubClient } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import { resolveReviewTarget } from "./review-target";

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function fakeGitHub(mergeBase = vi.fn(async () => "m".repeat(40))): GitHubClient {
  return {
    mergeBase,
    installationTokenById: unsupported(),
    installationToken: unsupported(),
    pullRequest: unsupported(),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    updateReview: unsupported(),
    createCommitStatus: vi.fn(async () => {}),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

const reference = { owner: "octo", repo: "repo", number: 7 };

describe("resolveReviewTarget", () => {
  it("keeps the head and replaces the base with the merge base", async () => {
    const mergeBase = vi.fn(async () => "m".repeat(40));
    const target = await resolveReviewTarget(fakeGitHub(mergeBase), {
      reference,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      token: "ghs_t",
    });
    expect(target).toEqual({ headSha: "h".repeat(40), baseSha: "m".repeat(40) });
    expect(mergeBase).toHaveBeenCalledWith(reference, "b".repeat(40), "h".repeat(40), "ghs_t");
  });
  it("propagates a failure from the compare call", async () => {
    const failing = vi.fn(async () => {
      throw new Error("GitHub GET /repos/octo/repo/compare failed: 500");
    });
    await expect(
      resolveReviewTarget(fakeGitHub(failing), {
        reference,
        headSha: "h",
        baseSha: "b",
        token: "t",
      }),
    ).rejects.toThrow(/500/);
  });
});
