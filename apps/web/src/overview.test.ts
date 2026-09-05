import type { ReviewResult } from "@hawkeye/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { dayKey, loadOverview } from "./overview";
import { createRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const now = new Date("2026-09-15T12:00:00Z");
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
let heads = 0;

async function postReview(
  armedPrId: string,
  endedAt: Date,
  overrides: { verdict?: ReviewResult["verdict"]; turns?: number; minutes?: number } = {},
) {
  heads += 1;
  const headSha = heads.toString(16).padStart(40, "0");
  const [job] = await db
    .insert(schema.job)
    .values({ armedPrId, headSha, baseSha: "b".repeat(40), notBefore: endedAt, state: "done" })
    .returning();
  const [run] = await db
    .insert(schema.run)
    .values({
      jobId: job!.id,
      runnerId,
      status: "ok",
      result: { ...result, verdict: overrides.verdict ?? "changes_needed" },
      turns: overrides.turns ?? 10,
      startedAt: new Date(endedAt.getTime() - (overrides.minutes ?? 5) * 60_000),
      endedAt,
    })
    .returning();
  await db.insert(schema.reviewPosted).values({
    runId: run!.id,
    armedPrId,
    headSha,
    githubReviewId: `review-${run!.id}`,
  });
  return headSha;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  runnerId = (await createRunnerToken(db, { userId: "user-1", name: "laptop" })).runner.id;
});

describe("loadOverview", () => {
  it("returns zeros and nothing recent for a new account", async () => {
    const overview = await loadOverview(db, "user-1", now);
    expect(overview.allTime.reviews).toBe(0);
    expect(overview.thisMonth).toEqual(overview.allTime);
    expect(overview.reviewsByDay.size).toBe(0);
    expect(overview.recent).toEqual([]);
  });

  it("totals posted reviews all time and this month, with cost and distinct pull requests", async () => {
    await seedArmedPullRequest(db, { armedPrId: "armed-2", number: 8 });
    await postReview("armed-1", new Date("2026-08-20T10:00:00Z"), { turns: 20, minutes: 10 });
    const headSha = await postReview("armed-1", new Date("2026-09-10T10:00:00Z"), {
      verdict: "ship",
      turns: 12,
      minutes: 4,
    });
    await postReview("armed-2", new Date("2026-09-14T10:00:00Z"), { turns: 8, minutes: 2 });
    await db.insert(schema.finding).values([
      {
        armedPrId: "armed-1",
        stableId: "f1",
        severity: "must_fix",
        claim: "a",
        firstSeenSha: headSha,
      },
      {
        armedPrId: "armed-1",
        stableId: "f2",
        severity: "optional",
        claim: "b",
        firstSeenSha: headSha,
        resolvedSha: "c".repeat(40),
      },
      {
        armedPrId: "armed-1",
        stableId: "f3",
        severity: "should_fix",
        claim: "c",
        firstSeenSha: "1".repeat(40),
      },
    ]);

    const overview = await loadOverview(db, "user-1", now);
    expect(overview.allTime).toEqual({
      reviews: 3,
      pullRequests: 2,
      findings: 3,
      addressed: 1,
      mustFix: 1,
      turns: 40,
      seconds: 16 * 60,
    });
    expect(overview.thisMonth).toEqual({
      reviews: 2,
      pullRequests: 2,
      findings: 2,
      addressed: 1,
      mustFix: 1,
      turns: 20,
      seconds: 6 * 60,
    });
  });

  it("counts reviews per day over the last year and lists the five most recent", async () => {
    for (let index = 0; index < 7; index += 1)
      await postReview("armed-1", new Date(`2026-09-0${index + 1}T10:00:00Z`));
    await postReview("armed-1", new Date("2026-09-07T18:00:00Z"));
    await postReview("armed-1", new Date("2025-09-01T10:00:00Z"));

    const overview = await loadOverview(db, "user-1", now);
    expect(overview.reviewsByDay.get("2026-09-07")).toBe(2);
    expect(overview.reviewsByDay.get("2026-09-01")).toBe(1);
    expect(overview.reviewsByDay.has("2025-09-01")).toBe(false);
    expect(overview.recent).toHaveLength(5);
    expect(overview.recent[0]?.endedAt).toEqual(new Date("2026-09-07T18:00:00Z"));
    expect(overview.allTime.reviews).toBe(9);
  });

  it("ignores unposted runs and other users", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "hubot", email: "h@example.com" })
      .onConflictDoNothing();
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-2", number: 9 });
    await postReview("armed-2", new Date("2026-09-10T10:00:00Z"));
    const [job] = await db
      .insert(schema.job)
      .values({
        armedPrId: "armed-1",
        headSha: "d".repeat(40),
        baseSha: "b".repeat(40),
        notBefore: now,
      })
      .returning();
    await db
      .insert(schema.run)
      .values({ jobId: job!.id, runnerId, status: "ok", result, endedAt: now });

    expect((await loadOverview(db, "user-1", now)).allTime.reviews).toBe(0);
    expect((await loadOverview(db, "user-2", now)).allTime.reviews).toBe(1);
  });

  it("keys days by UTC date", () => {
    expect(dayKey(new Date("2026-09-05T23:59:59Z"))).toBe("2026-09-05");
  });
});
