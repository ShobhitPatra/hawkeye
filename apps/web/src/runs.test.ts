import type { ReviewResult } from "@hawkeye/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { createRunnerToken } from "./runner-tokens";
import { hasArmedPullRequest, listFindingsForPullRequest, listRunsForPullRequest } from "./runs";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const coordinates = { userId: "user-1", owner: "octo", repo: "repo", number: 7 };
const headSha = "a".repeat(40);

const result: ReviewResult = {
  verdict: "changes_needed",
  reportedVerdict: "mergeable",
  summary: "needs work",
  lenses: ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"].map((name) => ({
    name,
    assessment: "ok",
  })) as ReviewResult["lenses"],
  findings: [],
};

let db: Db;
let runnerId: string;

async function seedJob(armedPrId: string, overrides: Partial<typeof schema.job.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.job)
    .values({
      armedPrId,
      headSha,
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

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  runnerId = (await createRunnerToken(db, { userId: "user-1", name: "laptop" })).runner.id;
});

describe("listRunsForPullRequest", () => {
  it("returns runs of every arm of the user's pull request, ignoring other users", async () => {
    await db.insert(schema.armedPr).values({
      id: "armed-old",
      userId: "user-1",
      installationId: "10",
      owner: "octo",
      repo: "repo",
      number: 7,
      disarmedAt: new Date(),
    });
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "hubot", email: "h@example.com" })
      .onConflictDoNothing();
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-2", number: 7 });
    const mine = await seedRun((await seedJob("armed-1")).id);
    const disarmed = await seedRun((await seedJob("armed-old")).id);
    await seedRun((await seedJob("armed-2")).id);

    const runs = await listRunsForPullRequest(db, coordinates);
    expect(runs.map((r) => r.id).toSorted()).toEqual([mine.id, disarmed.id].toSorted());
  });

  it("sorts newest startedAt first and keeps raw dates", async () => {
    const jobId = (await seedJob("armed-1")).id;
    const older = await seedRun(jobId, {
      startedAt: new Date("2026-09-01T10:00:00Z"),
      endedAt: new Date("2026-09-01T10:04:32Z"),
      status: "ok",
    });
    const newer = await seedRun(jobId, { startedAt: new Date("2026-09-02T10:00:00Z") });

    const runs = await listRunsForPullRequest(db, coordinates);
    expect(runs.map((r) => r.id)).toEqual([newer.id, older.id]);
    expect(runs[1]).toMatchObject({
      status: "ok",
      headSha,
      turns: 0,
      startedAt: new Date("2026-09-01T10:00:00Z"),
      endedAt: new Date("2026-09-01T10:04:32Z"),
    });
    expect(runs[0]?.endedAt).toBeUndefined();
  });

  it("extracts verdict and reportedVerdict from the stored result", async () => {
    const jobId = (await seedJob("armed-1")).id;
    await seedRun(jobId, { status: "ok", result, turns: 12, error: "late" });

    const [row] = await listRunsForPullRequest(db, coordinates);
    expect(row).toMatchObject({
      verdict: "changes_needed",
      reportedVerdict: "mergeable",
      turns: 12,
      error: "late",
    });
  });

  it("composes the review url only when a review was posted", async () => {
    const jobId = (await seedJob("armed-1")).id;
    const posted = await seedRun(jobId, { status: "ok", result });
    const unposted = await seedRun(jobId, { startedAt: new Date("2026-09-03T00:00:00Z") });
    await db.insert(schema.reviewPosted).values({
      runId: posted.id,
      armedPrId: "armed-1",
      headSha,
      githubReviewId: "987",
    });

    const runs = await listRunsForPullRequest(db, coordinates);
    expect(runs.find((r) => r.id === posted.id)?.reviewUrl).toBe(
      "https://github.com/octo/repo/pull/7#pullrequestreview-987",
    );
    expect(runs.find((r) => r.id === unposted.id)?.reviewUrl).toBeUndefined();
  });
});

describe("listFindingsForPullRequest", () => {
  it("orders open before resolved, then by severity, then claim", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "hubot", email: "h@example.com" })
      .onConflictDoNothing();
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-2", number: 7 });
    await db.insert(schema.finding).values([
      {
        armedPrId: "armed-1",
        stableId: "f-resolved",
        severity: "must_fix",
        claim: "resolved one",
        firstSeenSha: headSha,
        resolvedSha: "c".repeat(40),
      },
      {
        armedPrId: "armed-1",
        stableId: "f-optional",
        severity: "optional",
        claim: "an optional",
        path: "a.txt",
        line: 3,
        firstSeenSha: headSha,
      },
      {
        armedPrId: "armed-1",
        stableId: "f-should-b",
        severity: "should_fix",
        claim: "b claim",
        firstSeenSha: headSha,
      },
      {
        armedPrId: "armed-1",
        stableId: "f-should-a",
        severity: "should_fix",
        claim: "a claim",
        firstSeenSha: headSha,
      },
      {
        armedPrId: "armed-2",
        stableId: "f-other-user",
        severity: "must_fix",
        claim: "not yours",
        firstSeenSha: headSha,
      },
    ]);

    const findings = await listFindingsForPullRequest(db, coordinates);
    expect(findings.map((f) => f.stableId)).toEqual([
      "f-should-a",
      "f-should-b",
      "f-optional",
      "f-resolved",
    ]);
    expect(findings[2]).toEqual({
      stableId: "f-optional",
      severity: "optional",
      claim: "an optional",
      path: "a.txt",
      line: 3,
      firstSeenSha: headSha,
      resolvedSha: null,
    });
  });
});

describe("hasArmedPullRequest", () => {
  it("finds active and disarmed arms of the user only", async () => {
    await expect(hasArmedPullRequest(db, coordinates)).resolves.toBe(true);
    await expect(hasArmedPullRequest(db, { ...coordinates, number: 8 })).resolves.toBe(false);
    await expect(hasArmedPullRequest(db, { ...coordinates, userId: "user-2" })).resolves.toBe(
      false,
    );

    await db.update(schema.armedPr).set({ disarmedAt: new Date() });
    await expect(hasArmedPullRequest(db, coordinates)).resolves.toBe(true);
  });
});
