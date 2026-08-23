import { GitHubRequestError, type GitHubClient } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import { assertPullRequestInInstallation } from "./arm-guard";

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function fakeGitHub(pullRequest: GitHubClient["pullRequest"]): GitHubClient {
  return {
    installationTokenById: vi.fn(async (installationId: string) => `token-${installationId}`),
    pullRequest,
    installationToken: unsupported(),
    mergeBase: unsupported(),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

const reference = { owner: "octo", repo: "repo", number: 7 };

describe("assertPullRequestInInstallation", () => {
  it("resolves when the pull request is reachable through the installation", async () => {
    const pullRequest: GitHubClient["pullRequest"] = vi.fn(
      async () => ({}) as Awaited<ReturnType<GitHubClient["pullRequest"]>>,
    );
    const github = fakeGitHub(pullRequest);

    await expect(assertPullRequestInInstallation(github, "10", reference)).resolves.toBeUndefined();
    expect(pullRequest).toHaveBeenCalledWith(reference, "token-10");
  });

  it("rejects with a clear message when the pull request is not found", async () => {
    const pullRequest = vi.fn(async () => {
      throw new GitHubRequestError(404, "not found");
    });
    const github = fakeGitHub(pullRequest);

    await expect(assertPullRequestInInstallation(github, "10", reference)).rejects.toThrow(
      "pull request octo/repo#7 is not reachable through installation 10",
    );
  });

  it("propagates other errors", async () => {
    const pullRequest = vi.fn(async () => {
      throw new GitHubRequestError(500, "failed: 500 Server Error");
    });
    const github = fakeGitHub(pullRequest);

    await expect(assertPullRequestInInstallation(github, "10", reference)).rejects.toThrow(
      "failed: 500 Server Error",
    );
  });
});
