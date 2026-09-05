import type { ReviewResult } from "@hawkeye/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { listPullRequestStatuses } from "./pull-request-status";
import { createRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const key = "octo/repo#7";
const result: ReviewResult = {
  verdict: "changes_needed",
  summary: "needs work",
  lenses: ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"].map((name) => ({
    name,
    assessment: "ok",
  })) as ReviewResult["lenses"],
  findings: [],
};

let db: Db;
let runnerId: string;

async function seedJob(overrides: Partial<typeof schema.job.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.job)
    .values({
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "done",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedRun(jobId: string, overrides: Partial<typeof schema.run.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.run)
    .values({ jobId, runnerId, ...overrides })
    .returning();
  return row!;
}

let heads = 0;

async function seedPostedReview(
  verdict: ReviewResult["verdict"],
  endedAt: Date,
  armedPrId = "armed-1",
) {
  heads += 1;
  const seededJob = await seedJob({
    armedPrId,
    notBefore: endedAt,
    headSha: heads.toString(16).padStart(40, "0"),
  });
  const seededRun = await seedRun(seededJob.id, {
    status: "ok",
    result: { ...result, verdict },
    endedAt,
  });
  await db.insert(schema.reviewPosted).values({
    runId: seededRun.id,
    armedPrId,
    headSha: seededJob.headSha,
    githubReviewId: `review-${seededRun.id}`,
  });
  return endedAt;
}

async function statusOf(userId = "user-1") {
  return (await listPullRequestStatuses(db, userId)).get(key);
}

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  runnerId = (await createRunnerToken(db, { userId: "user-1", name: "laptop" })).runner.id;
});

describe("listPullRequestStatuses", () => {
  it("reports an armed pull request with no job as armed", async () => {
    expect(await statusOf()).toEqual({ kind: "armed" });
  });

  it("follows an open job through queued and claimed", async () => {
    await seedJob({ state: "queued" });
    expect(await statusOf()).toEqual({ kind: "queued" });
    await db.update(schema.job).set({ state: "claimed" });
    expect(await statusOf()).toEqual({ kind: "reviewing" });
  });

  it("prefers a job queued during a review over the finished review", async () => {
    await seedJob({ state: "queued", notBefore: new Date(Date.now() - 120_000) });
    const reviewedAt = await seedPostedReview("ship", new Date());

    expect(await statusOf()).toEqual({
      kind: "queued",
      last: { verdict: "ship", rounds: 1, openFindings: 0, reviewedAt },
    });
  });

  it("counts only posted reviews as rounds and reports the latest one", async () => {
    await seedPostedReview("changes_needed", new Date(Date.now() - 90_000));
    const timedOut = await seedJob({ state: "failed" });
    await seedRun(timedOut.id, { status: "timeout", endedAt: new Date(Date.now() - 60_000) });
    const reviewedAt = await seedPostedReview("ship", new Date());
    await db.insert(schema.finding).values([
      {
        armedPrId: "armed-1",
        stableId: "f1",
        severity: "must_fix",
        claim: "a",
        firstSeenSha: "a".repeat(40),
      },
      {
        armedPrId: "armed-1",
        stableId: "f2",
        severity: "optional",
        claim: "b",
        firstSeenSha: "a".repeat(40),
        resolvedSha: "c".repeat(40),
      },
    ]);

    expect(await statusOf()).toEqual({
      kind: "reviewed",
      last: { verdict: "ship", rounds: 2, openFindings: 1, reviewedAt },
    });
  });

  it("keeps counting across a disarm and re-arm of the same pull request", async () => {
    await seedPostedReview("changes_needed", new Date(Date.now() - 60_000));
    await db.update(schema.armedPr).set({ disarmedAt: new Date() });
    await seedArmedPullRequest(db, { armedPrId: "armed-again" });
    await db.insert(schema.finding).values({
      armedPrId: "armed-1",
      stableId: "f1",
      severity: "must_fix",
      claim: "a",
      firstSeenSha: "a".repeat(40),
    });
    const reviewedAt = await seedPostedReview("ship", new Date(), "armed-again");

    expect(await statusOf()).toEqual({
      kind: "reviewed",
      last: { verdict: "ship", rounds: 2, openFindings: 1, reviewedAt },
    });
  });

  it("reports a failed latest run while keeping the last posted review", async () => {
    const reviewedAt = await seedPostedReview("ship", new Date(Date.now() - 60_000));
    const failed = await seedJob({ state: "failed" });
    await seedRun(failed.id, { status: "timeout", endedAt: new Date() });

    expect(await statusOf()).toEqual({
      kind: "failed",
      last: { verdict: "ship", rounds: 1, openFindings: 0, reviewedAt },
    });
  });

  it("reports a failed first run with nothing to carry", async () => {
    const failed = await seedJob({ state: "failed" });
    await seedRun(failed.id, { status: "error", endedAt: new Date() });
    expect(await statusOf()).toEqual({ kind: "failed" });
  });

  it("ignores disarmed pull requests and other users", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "hubot", email: "h@example.com" })
      .onConflictDoNothing();
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-2", number: 8 });
    await seedJob({ armedPrId: "armed-2", state: "queued" });

    expect([...(await listPullRequestStatuses(db, "user-1")).keys()]).toEqual([key]);
    expect([...(await listPullRequestStatuses(db, "user-2")).keys()]).toEqual(["octo/repo#8"]);

    await db.update(schema.armedPr).set({ disarmedAt: new Date() });
    expect((await listPullRequestStatuses(db, "user-1")).size).toBe(0);
  });
});
