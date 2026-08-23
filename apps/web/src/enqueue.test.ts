import type { GitHubClient } from "@hawkeye/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import { enqueueReviewForArmedPullRequest } from "./enqueue";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
});

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function fakeGitHub(): GitHubClient {
  return {
    installationTokenById: vi.fn(async (installationId: string) => `token-${installationId}`),
    mergeBase: vi.fn(async () => "m".repeat(40)),
    installationToken: unsupported(),
    pullRequest: unsupported(),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

const armedPr = {
  id: "armed-1",
  installationId: "10",
  owner: "octo",
  repo: "repo",
  number: 7,
};

describe("enqueueReviewForArmedPullRequest", () => {
  it("resolves the merge base with the given token and queues the job", async () => {
    const github = fakeGitHub();
    const before = Date.now();

    const enqueued = await enqueueReviewForArmedPullRequest(
      { db, github },
      {
        armedPr,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40),
        delaySeconds: 0,
        token: "token-10",
      },
    );

    expect(github.installationTokenById).not.toHaveBeenCalled();
    expect(github.mergeBase).toHaveBeenCalledWith(
      { owner: "octo", repo: "repo", number: 7 },
      "b".repeat(40),
      "a".repeat(40),
      "token-10",
    );
    expect(enqueued).toMatchObject({
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "m".repeat(40),
      state: "queued",
    });
    expect(enqueued.notBefore.getTime()).toBeGreaterThanOrEqual(before);
    expect(enqueued.notBefore.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("delays the job by the requested quiet window", async () => {
    const before = Date.now();

    const enqueued = await enqueueReviewForArmedPullRequest(
      { db, github: fakeGitHub() },
      {
        armedPr,
        headSha: "c".repeat(40),
        baseSha: "d".repeat(40),
        delaySeconds: 180,
        token: "token-10",
      },
    );

    expect(enqueued.notBefore.getTime()).toBeGreaterThanOrEqual(before + 180_000);
    expect(enqueued.notBefore.getTime()).toBeLessThanOrEqual(Date.now() + 180_000);
  });
});
