import { describe, expect, it } from "vitest";
import { armedPullRequestKey } from "./arming";
import { findRepository, listRepositories, narrowToRepository } from "./repository-filter";

function pullRequest(owner: string, repo: string, number: number, updatedAt: string) {
  return { owner, repo, number, updatedAt };
}

describe("listRepositories", () => {
  it("names each repository once, the most recently updated first", () => {
    expect(
      listRepositories([
        pullRequest("acme", "api", 1, "2026-10-20T00:00:00Z"),
        pullRequest("acme", "web", 2, "2026-10-22T00:00:00Z"),
        pullRequest("acme", "api", 3, "2026-10-24T00:00:00Z"),
        pullRequest("octo", "cli", 4, "2026-10-21T00:00:00Z"),
      ]),
    ).toEqual(["acme/api", "acme/web", "octo/cli"]);
  });
  it("keeps a fork apart from its upstream", () => {
    expect(
      listRepositories([
        pullRequest("acme", "api", 1, "2026-10-20T00:00:00Z"),
        pullRequest("me", "api", 2, "2026-10-21T00:00:00Z"),
      ]),
    ).toEqual(["me/api", "acme/api"]);
  });
  it("lists nothing for no pull requests", () => {
    expect(listRepositories([])).toEqual([]);
  });
});

describe("findRepository", () => {
  it("matches without regard to case and returns the listed name", () => {
    expect(findRepository(["Acme/API", "octo/cli"], "acme/api")).toBe("Acme/API");
  });
  it("finds nothing for a repository that is not listed", () => {
    expect(findRepository(["acme/api"], "acme/web")).toBeUndefined();
    expect(findRepository(["acme/api"], "acme")).toBeUndefined();
  });
});

describe("narrowToRepository", () => {
  const listed = [
    pullRequest("Acme", "api", 1, "2026-10-20T00:00:00Z"),
    pullRequest("Acme", "api-docs", 2, "2026-10-21T00:00:00Z"),
    pullRequest("octo", "cli", 3, "2026-10-22T00:00:00Z"),
  ];
  const statuses = new Map(listed.map((listing) => [armedPullRequestKey(listing), listing.number]));

  it("keeps the pull requests and statuses of one repository, matched without regard to case", () => {
    const narrowed = narrowToRepository({ pullRequests: listed, statuses }, "acme/API");
    expect(narrowed.pullRequests.map((listing) => listing.number)).toEqual([1]);
    expect([...narrowed.statuses.keys()]).toEqual(["Acme/api#1"]);
  });
  it("keeps nothing for a repository with no open pull request", () => {
    const narrowed = narrowToRepository({ pullRequests: listed, statuses }, "acme/web");
    expect(narrowed.pullRequests).toEqual([]);
    expect(narrowed.statuses.size).toBe(0);
  });
});
