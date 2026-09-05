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
  await db.insert(schema.run).values({ jobId, runnerId, ...overrides });
}

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  runnerId = (await createRunnerToken(db, { userId: "user-1", name: "laptop" })).runner.id;
});

describe("listPullRequestStatuses", () => {
  it("reports an armed pull request with no job as armed", async () => {
    expect((await listPullRequestStatuses(db, "user-1")).get(key)).toEqual({ kind: "armed" });
  });

  it("follows the latest job through queued and claimed", async () => {
    await seedJob({ state: "queued" });
    expect((await listPullRequestStatuses(db, "user-1")).get(key)).toEqual({ kind: "queued" });
    await db.update(schema.job).set({ state: "claimed", updatedAt: new Date() });
    expect((await listPullRequestStatuses(db, "user-1")).get(key)).toEqual({ kind: "reviewing" });
  });

  it("reports the verdict, round count, open findings and end time of the latest completed run", async () => {
    const first = await seedJob({ notBefore: new Date(Date.now() - 60_000) });
    await seedRun(first.id, { status: "ok", result, endedAt: new Date(Date.now() - 50_000) });
    const second = await seedJob();
    const endedAt = new Date();
    await seedRun(second.id, { status: "ok", result: { ...result, verdict: "ship" }, endedAt });
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

    expect((await listPullRequestStatuses(db, "user-1")).get(key)).toEqual({
      kind: "reviewed",
      verdict: "ship",
      rounds: 2,
      openFindings: 1,
      reviewedAt: endedAt,
    });
  });

  it("reports a run that did not complete as failed", async () => {
    const done = await seedJob({ state: "failed" });
    const endedAt = new Date();
    await seedRun(done.id, { status: "timeout", endedAt });
    expect((await listPullRequestStatuses(db, "user-1")).get(key)).toEqual({
      kind: "failed",
      rounds: 1,
      reviewedAt: endedAt,
    });
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
