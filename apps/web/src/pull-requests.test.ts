import type { GitHubClient, InstallationRepository, OpenPullRequest } from "@hawkeye/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { listUserOpenPullRequests } from "./pull-requests";
import { createTestDb } from "./test/pglite";

let db: Db;

function repository(owner: string, name: string): InstallationRepository {
  return { owner, name, fullName: `${owner}/${name}`, private: false };
}

function pullRequest(owner: string, number: number, updatedAt: string): OpenPullRequest {
  return {
    owner,
    repo: "repo",
    number,
    title: `pr ${number}`,
    headRef: `head-${number}`,
    headSha: `sha-${number}`,
    updatedAt,
    htmlUrl: `https://github.com/${owner}/repo/pull/${number}`,
  };
}

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function fakeGitHub(
  repositories: Record<string, InstallationRepository[]>,
  pullRequests: Record<string, OpenPullRequest[]>,
  broken: Record<string, string> = {},
) {
  const installationTokenById = vi.fn(async (installationId: string) => {
    const failure = broken[installationId];
    if (failure) throw new Error(failure);
    return `token-${installationId}`;
  });
  const listInstallationRepositories = vi.fn(async (token: string) => repositories[token] ?? []);
  const listOpenPullRequestsByAuthor = vi.fn(async (token: string) => pullRequests[token] ?? []);
  const github: GitHubClient = {
    installationTokenById,
    listInstallationRepositories,
    listOpenPullRequestsByAuthor,
    installationToken: unsupported(),
    pullRequest: unsupported(),
    mergeBase: unsupported(),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    updateReview: unsupported(),
  };
  return {
    github,
    installationTokenById,
    listInstallationRepositories,
    listOpenPullRequestsByAuthor,
  };
}

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.user).values([
    { id: "user-1", name: "octocat", email: "octocat@example.com", githubLogin: "octocat" },
    { id: "user-2", name: "hubot", email: "hubot@example.com", githubLogin: "hubot" },
  ]);
  await db.insert(schema.installation).values([
    { id: "10", accountLogin: "octo", accountType: "Organization" },
    { id: "11", accountLogin: "acme", accountType: "Organization" },
    { id: "12", accountLogin: "gone", accountType: "Organization", deletedAt: new Date() },
    { id: "13", accountLogin: "other", accountType: "User" },
  ]);
  await db.insert(schema.installationUser).values([
    { installationId: "10", userId: "user-1" },
    { installationId: "11", userId: "user-1" },
    { installationId: "12", userId: "user-1" },
    { installationId: "13", userId: "user-2" },
  ]);
});

describe("listUserOpenPullRequests", () => {
  it("merges the pull requests of every live installation, newest first", async () => {
    const octoRepositories = [repository("octo", "repo")];
    const acmeRepositories = [repository("acme", "repo")];
    const {
      github,
      installationTokenById,
      listInstallationRepositories,
      listOpenPullRequestsByAuthor,
    } = fakeGitHub(
      { "token-10": octoRepositories, "token-11": acmeRepositories },
      {
        "token-10": [pullRequest("octo", 1, "2026-08-01T00:00:00Z")],
        "token-11": [
          pullRequest("acme", 2, "2026-08-03T00:00:00Z"),
          pullRequest("acme", 3, "2026-08-02T00:00:00Z"),
        ],
      },
    );

    const found = await listUserOpenPullRequests(
      { db, github },
      { userId: "user-1", login: "octocat" },
    );

    expect(found.pullRequests.map((pr) => pr.number)).toEqual([2, 3, 1]);
    expect(found.pullRequests.map((pr) => pr.installationId)).toEqual(["11", "11", "10"]);
    expect(found.failures).toEqual([]);
    expect(installationTokenById.mock.calls).toEqual([["10"], ["11"]]);
    expect(listInstallationRepositories.mock.calls).toEqual([["token-10"], ["token-11"]]);
    expect(listOpenPullRequestsByAuthor.mock.calls).toEqual([
      ["token-10", octoRepositories, "octocat"],
      ["token-11", acmeRepositories, "octocat"],
    ]);
  });

  it("returns nothing for a user without live installations", async () => {
    const { github, installationTokenById } = fakeGitHub({}, {});

    await expect(
      listUserOpenPullRequests({ db, github }, { userId: "ghost", login: "ghost" }),
    ).resolves.toEqual({ pullRequests: [], failures: [] });
    expect(installationTokenById).not.toHaveBeenCalled();
  });

  it("only reads the installations linked to the user", async () => {
    const { github, installationTokenById } = fakeGitHub({}, {});

    await listUserOpenPullRequests({ db, github }, { userId: "user-2", login: "hubot" });

    expect(installationTokenById.mock.calls).toEqual([["13"]]);
  });

  it("reports a failing installation and still returns the others' pull requests", async () => {
    const acmeRepositories = [repository("acme", "repo")];
    const { github } = fakeGitHub(
      { "token-11": acmeRepositories },
      { "token-11": [pullRequest("acme", 2, "2026-08-03T00:00:00Z")] },
      { "10": "installation token minting failed" },
    );

    const found = await listUserOpenPullRequests(
      { db, github },
      { userId: "user-1", login: "octocat" },
    );

    expect(found.pullRequests.map((pr) => pr.number)).toEqual([2]);
    expect(found.failures).toEqual([
      { installationId: "10", message: "installation token minting failed" },
    ]);
  });
});
