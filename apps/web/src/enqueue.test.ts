import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { GitHubClient } from "@hawkeye/core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { enqueueReviewForArmedPullRequest, quietWindowSeconds } from "./enqueue";

const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite;

  await db.insert(schema.user).values({ id: "user-1", name: "octocat", email: "o@example.com" });
  await db
    .insert(schema.installation)
    .values({ id: "10", accountLogin: "octo", accountType: "Organization" });
  await db.insert(schema.armedPr).values({
    id: "armed-1",
    userId: "user-1",
    installationId: "10",
    owner: "octo",
    repo: "repo",
    number: 7,
  });
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
  it("mints an installation token, resolves the merge base and queues the job", async () => {
    const github = fakeGitHub();
    const before = Date.now();

    const enqueued = await enqueueReviewForArmedPullRequest(
      { db, github },
      { armedPr, headSha: "a".repeat(40), baseSha: "b".repeat(40), delaySeconds: 0 },
    );

    expect(github.installationTokenById).toHaveBeenCalledWith("10");
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
      { armedPr, headSha: "c".repeat(40), baseSha: "d".repeat(40), delaySeconds: 180 },
    );

    expect(enqueued.notBefore.getTime()).toBeGreaterThanOrEqual(before + 180_000);
    expect(enqueued.notBefore.getTime()).toBeLessThanOrEqual(Date.now() + 180_000);
  });
});

describe("quietWindowSeconds", () => {
  it("prefers the per-pull-request window", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 60 }, { quietWindowSeconds: 30 })).toBe(30);
  });

  it("falls back to the user setting", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 60 }, { quietWindowSeconds: null })).toBe(60);
  });

  it("falls back to the default when neither is set", () => {
    expect(quietWindowSeconds(undefined, { quietWindowSeconds: null })).toBe(180);
  });
});
