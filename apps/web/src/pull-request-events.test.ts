import type { GitHubClient } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { PullRequestEvent } from "./github/webhook-events";
import { handlePullRequestEvent } from "./pull-request-events";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function pullRequestWithHead(headSha: string) {
  return {
    number: 7,
    title: "title",
    body: "",
    author: "octocat",
    draft: false,
    headSha,
    headRef: "feature",
    baseSha: "b".repeat(40),
    baseRef: "main",
    cloneUrl: "https://github.com/octo/repo.git",
  };
}

function fakeGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    mergeBase: vi.fn(async () => "m".repeat(40)),
    installationTokenById: vi.fn(async () => "ghs_t"),
    installationToken: unsupported(),
    pullRequest: vi.fn(async () => pullRequestWithHead("h".repeat(40))),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
    ...overrides,
  };
}

function event(overrides: Partial<PullRequestEvent> = {}): PullRequestEvent {
  return {
    type: "pull_request",
    action: "synchronize",
    repository: { owner: "octo", name: "repo" },
    number: 7,
    headSha: "h".repeat(40),
    baseSha: "b".repeat(40),
    draft: false,
    merged: false,
    installationId: "10",
    ...overrides,
  };
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

function jobs() {
  return db.select().from(schema.job);
}

describe("handlePullRequestEvent", () => {
  it("queues a job for the merge base after the default quiet window", async () => {
    const armed = await seedArmedPullRequest(db);
    const before = Date.now();
    const result = await handlePullRequestEvent({ db, github: fakeGitHub() }, event());

    expect(result).toEqual({ enqueued: 1, disarmed: 0, cancelled: 0 });
    const rows = await jobs();
    expect(rows).toMatchObject([
      { armedPrId: armed.armedPrId, headSha: "h".repeat(40), baseSha: "m".repeat(40) },
    ]);
    const delay = rows[0]!.notBefore.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(179_000);
    expect(delay).toBeLessThanOrEqual(200_000);
  });

  it("collapses a second push onto the waiting job", async () => {
    await seedArmedPullRequest(db);
    const pullRequest = vi.fn();
    pullRequest.mockResolvedValueOnce(pullRequestWithHead("h".repeat(40)));
    pullRequest.mockResolvedValueOnce(pullRequestWithHead("c".repeat(40)));
    const github = fakeGitHub({ pullRequest });
    await handlePullRequestEvent({ db, github }, event());
    await handlePullRequestEvent({ db, github }, event({ headSha: "c".repeat(40) }));

    const rows = await jobs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ headSha: "c".repeat(40) });
  });

  it("queues immediately when the user quiet window is zero", async () => {
    const armed = await seedArmedPullRequest(db);
    await db.insert(schema.userSettings).values({ userId: armed.userId, quietWindowSeconds: 0 });

    const before = Date.now();
    await handlePullRequestEvent({ db, github: fakeGitHub() }, event());
    const rows = await jobs();
    expect(rows[0]!.notBefore.getTime() - before).toBeLessThan(5_000);
  });

  it("prefers the armed pull request quiet window over the user setting", async () => {
    const armed = await seedArmedPullRequest(db);
    await db.insert(schema.userSettings).values({ userId: armed.userId, quietWindowSeconds: 600 });
    await db
      .update(schema.armedPr)
      .set({ quietWindowSeconds: 0 })
      .where(eq(schema.armedPr.id, armed.armedPrId));

    const before = Date.now();
    await handlePullRequestEvent({ db, github: fakeGitHub() }, event());
    const rows = await jobs();
    expect(rows[0]!.notBefore.getTime() - before).toBeLessThan(5_000);
  });

  it("skips a draft pull request unless the user opted in", async () => {
    const armed = await seedArmedPullRequest(db);
    const skipped = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ draft: true }),
    );
    expect(skipped).toEqual({ enqueued: 0, disarmed: 0, cancelled: 0 });
    expect(await jobs()).toHaveLength(0);

    await db.insert(schema.userSettings).values({ userId: armed.userId, reviewDrafts: true });
    const reviewed = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ draft: true }),
    );
    expect(reviewed).toEqual({ enqueued: 1, disarmed: 0, cancelled: 0 });
  });

  it("queues on ready_for_review", async () => {
    await seedArmedPullRequest(db);
    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ action: "ready_for_review" }),
    );
    expect(result).toEqual({ enqueued: 1, disarmed: 0, cancelled: 0 });
  });

  it("queues one job per armed row when two users armed the pull request", async () => {
    await seedArmedPullRequest(db);
    await db.insert(schema.user).values({ id: "user-2", name: "hubot", email: "h@example.com" });
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-2" });

    const github = fakeGitHub();
    const result = await handlePullRequestEvent({ db, github }, event());
    expect(result).toEqual({ enqueued: 2, disarmed: 0, cancelled: 0 });
    expect(await jobs()).toHaveLength(2);
    expect(github.installationTokenById).toHaveBeenCalledTimes(1);
  });

  it("disarms every active arm when the pull request closes", async () => {
    await seedArmedPullRequest(db);
    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ action: "closed", merged: true }),
    );

    expect(result).toEqual({ enqueued: 0, disarmed: 1, cancelled: 0 });
    expect(await jobs()).toHaveLength(0);
    const [row] = await db.select().from(schema.armedPr);
    expect(row!.disarmedAt).not.toBeNull();
  });

  it("cancels a queued job when the pull request closes", async () => {
    const armed = await seedArmedPullRequest(db);
    await db.insert(schema.job).values({
      armedPrId: armed.armedPrId,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "queued",
    });

    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ action: "closed", merged: true }),
    );

    expect(result).toEqual({ enqueued: 0, disarmed: 1, cancelled: 1 });
    expect(await jobs()).toHaveLength(0);
  });

  it("leaves a claimed job in place when the pull request closes", async () => {
    const armed = await seedArmedPullRequest(db);
    await db.insert(schema.job).values({
      armedPrId: armed.armedPrId,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "claimed",
    });

    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ action: "closed", merged: true }),
    );

    expect(result).toEqual({ enqueued: 0, disarmed: 1, cancelled: 0 });
    expect(await jobs()).toHaveLength(1);
  });

  it("does nothing for an unarmed pull request", async () => {
    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ number: 99 }),
    );
    expect(result).toEqual({ enqueued: 0, disarmed: 0, cancelled: 0 });
    expect(await jobs()).toHaveLength(0);
  });

  it("does nothing when an unarmed pull request closes", async () => {
    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ number: 98, action: "closed", merged: true }),
    );
    expect(result).toEqual({ enqueued: 0, disarmed: 0, cancelled: 0 });
  });

  it("ignores a delivery whose head is no longer current", async () => {
    await seedArmedPullRequest(db);
    const github = fakeGitHub({
      pullRequest: vi.fn(async () => pullRequestWithHead("d".repeat(40))),
    });
    const result = await handlePullRequestEvent({ db, github }, event());
    expect(result).toEqual({ enqueued: 0, disarmed: 0, cancelled: 0, ignored: "stale head" });
    expect(await jobs()).toHaveLength(0);
  });

  it("reports an action it does not act on", async () => {
    await seedArmedPullRequest(db);
    const result = await handlePullRequestEvent(
      { db, github: fakeGitHub() },
      event({ action: "labeled" }),
    );
    expect(result).toEqual({ enqueued: 0, disarmed: 0, cancelled: 0, ignored: "labeled" });
  });
});
