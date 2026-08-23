import type { ReviewResult } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import {
  claimNextJob,
  completeRun,
  createRun,
  heartbeatJob,
  holdsJobClaim,
  requeueStaleJobs,
} from "./job-queue";
import { enqueueJob } from "./jobs";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");

function minutesBefore(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db, { armedPrId: "armed-1", userId: "user-1", repo: "a", number: 1 });
  await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-1", repo: "b", number: 2 });
  await db
    .insert(schema.user)
    .values({ id: "user-2", name: "hubot", email: "h@example.com" })
    .onConflictDoNothing();
  await seedArmedPullRequest(db, { armedPrId: "armed-3", userId: "user-2", repo: "c", number: 3 });
  await db.insert(schema.runner).values([
    { id: "runner-1", userId: "user-1", name: "laptop", tokenHash: "hash-1" },
    { id: "runner-2", userId: "user-1", name: "desktop", tokenHash: "hash-2" },
  ]);
});

function enqueue(armedPrId: string, notBefore: Date) {
  return enqueueJob(db, {
    armedPrId,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    notBefore,
  });
}

function claim(runnerId = "runner-1", userId = "user-1") {
  return claimNextJob(db, { runnerId, userId, now });
}

describe("claimNextJob", () => {
  it("claims the oldest ready job and stamps the runner", async () => {
    const older = await enqueue("armed-1", minutesBefore(10));
    await enqueue("armed-2", minutesBefore(1));

    const claimed = await claim();

    expect(claimed?.id).toBe(older.id);
    expect(claimed).toMatchObject({
      state: "claimed",
      claimedByRunnerId: "runner-1",
    });
    expect(claimed?.claimedAt?.toISOString()).toBe(now.toISOString());
    expect(claimed?.heartbeatAt?.toISOString()).toBe(now.toISOString());
  });

  it("skips jobs whose pull request has been disarmed", async () => {
    await enqueue("armed-1", minutesBefore(10));
    await db
      .update(schema.armedPr)
      .set({ disarmedAt: new Date() })
      .where(eq(schema.armedPr.id, "armed-1"));

    expect(await claim()).toBeUndefined();
  });

  it("hands two runners two different jobs", async () => {
    const first = await enqueue("armed-1", minutesBefore(10));
    const second = await enqueue("armed-2", minutesBefore(5));

    const one = await claim("runner-1");
    const two = await claim("runner-2");

    expect(one?.id).toBe(first.id);
    expect(two?.id).toBe(second.id);
    expect(await claim("runner-1")).toBeUndefined();
  });

  it("leaves a job whose quiet window has not elapsed", async () => {
    await enqueue("armed-1", new Date(now.getTime() + 60_000));

    expect(await claim()).toBeUndefined();
  });

  it("never claims another user's job", async () => {
    const theirs = await enqueue("armed-3", minutesBefore(10));

    expect(await claim("runner-1", "user-1")).toBeUndefined();

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, theirs.id));
    expect(row?.state).toBe("queued");
  });

  it("returns nothing when the queue is empty", async () => {
    expect(await claim()).toBeUndefined();
  });
});

describe("heartbeatJob", () => {
  it("moves the heartbeat forward for the claiming runner", async () => {
    await enqueue("armed-1", minutesBefore(10));
    const claimed = await claim();
    const later = new Date(now.getTime() + 30_000);

    const beat = await heartbeatJob(db, {
      jobId: claimed?.id ?? "",
      runnerId: "runner-1",
      now: later,
    });

    expect(beat?.heartbeatAt?.toISOString()).toBe(later.toISOString());
  });

  it("ignores a heartbeat from another runner or for an unclaimed job", async () => {
    await enqueue("armed-1", minutesBefore(10));
    const claimed = await claim();
    const queued = await enqueue("armed-2", minutesBefore(5));

    expect(
      await heartbeatJob(db, { jobId: claimed?.id ?? "", runnerId: "runner-2", now }),
    ).toBeUndefined();
    expect(await heartbeatJob(db, { jobId: queued.id, runnerId: "runner-1", now })).toBeUndefined();
  });
});

describe("requeueStaleJobs", () => {
  it("requeues a claim whose heartbeat went silent", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });

    expect(await requeueStaleJobs(db, { now })).toBe(1);

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, stale.id));
    expect(row).toMatchObject({
      state: "queued",
      claimedByRunnerId: null,
      claimedAt: null,
      heartbeatAt: null,
    });
  });

  it("marks the abandoned run of a requeued job as an error", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const abandoned = await createRun(db, { jobId: stale.id, runnerId: "runner-1" });
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });

    expect(await requeueStaleJobs(db, { now })).toBe(1);

    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, abandoned.id));
    expect(row).toMatchObject({ status: "error", error: "heartbeat lost" });
    expect(row?.endedAt?.toISOString()).toBe(now.toISOString());
  });

  it("leaves an already finished run of a requeued job alone", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const finished = await createRun(db, { jobId: stale.id, runnerId: "runner-1" });
    await completeRun(db, {
      runId: finished.id,
      runnerId: "runner-1",
      status: "ok",
      turns: 2,
      result: reviewResult,
    });
    await db
      .update(schema.job)
      .set({ state: "claimed", claimedByRunnerId: "runner-1", heartbeatAt: minutesBefore(6) })
      .where(eq(schema.job.id, stale.id));

    expect(await requeueStaleJobs(db, { now })).toBe(1);

    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, finished.id));
    expect(row).toMatchObject({ status: "ok", error: null });
  });

  it("leaves a live claim alone", async () => {
    const live = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: live.id, runnerId: "runner-1", now: minutesBefore(1) });

    expect(await requeueStaleJobs(db, { now })).toBe(0);

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, live.id));
    expect(row?.state).toBe("claimed");
  });

  it("fails a stale claim that a newer queued job has superseded", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });
    const fresh = await enqueue("armed-1", minutesBefore(1));

    expect(await requeueStaleJobs(db, { now })).toBe(1);

    const rows = await db.select().from(schema.job).where(eq(schema.job.armedPrId, "armed-1"));
    expect(rows.find((row) => row.id === stale.id)?.state).toBe("failed");
    expect(rows.find((row) => row.id === fresh.id)?.state).toBe("queued");
  });

  it("honours a custom staleness window", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(2) });

    expect(await requeueStaleJobs(db, { now, staleAfterSeconds: 60 })).toBe(1);
  });
});

const reviewResult: ReviewResult = {
  verdict: "ship",
  summary: "looks good",
  lenses: [
    { name: "intent", assessment: "clear" },
    { name: "behavior", assessment: "clear" },
    { name: "blast_radius", assessment: "clear" },
    { name: "verification", assessment: "clear" },
    { name: "fit", assessment: "clear" },
    { name: "hygiene", assessment: "clear" },
  ],
  findings: [],
};

describe("createRun and completeRun", () => {
  it("opens a running run for the claimed job", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();

    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });

    expect(created).toMatchObject({
      jobId: claimed.id,
      runnerId: "runner-1",
      status: "running",
      turns: 0,
      result: null,
      endedAt: null,
    });
  });

  it("stores the review result and marks the job done", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });

    const completed = await completeRun(db, {
      runId: created.id,
      runnerId: "runner-1",
      status: "ok",
      turns: 7,
      result: reviewResult,
    });

    expect(completed).toMatchObject({ status: "ok", turns: 7, error: null });
    expect(completed?.result).toEqual(reviewResult);
    expect(completed?.endedAt).toBeInstanceOf(Date);

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, claimed.id));
    expect(row?.state).toBe("done");
  });

  it("marks the job failed for a non-ok status", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });

    const completed = await completeRun(db, {
      runId: created.id,
      runnerId: "runner-1",
      status: "timeout",
      turns: 40,
      error: "wall clock exceeded",
    });

    expect(completed).toMatchObject({ status: "timeout", error: "wall clock exceeded" });

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, claimed.id));
    expect(row?.state).toBe("failed");
  });

  it("refuses to complete a run twice", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });
    const ok = {
      runId: created.id,
      runnerId: "runner-1",
      status: "ok" as const,
      turns: 1,
      result: reviewResult,
    };
    await completeRun(db, ok);

    expect(await completeRun(db, ok)).toBeUndefined();
  });

  it("ignores a completion from a runner that no longer holds the claim", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });
    await db
      .update(schema.job)
      .set({ claimedByRunnerId: "runner-2" })
      .where(eq(schema.job.id, claimed.id));

    expect(
      await completeRun(db, {
        runId: created.id,
        runnerId: "runner-1",
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
    ).toBeUndefined();

    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, created.id));
    expect(row).toMatchObject({ status: "running", result: null, endedAt: null });
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, claimed.id));
    expect(jobRow?.state).toBe("claimed");
  });
});

describe("holdsJobClaim", () => {
  it("holds while the run's job is still claimed by the same runner", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });

    expect(await holdsJobClaim(db, { runId: created.id, runnerId: "runner-1" })).toBe(true);
    expect(await holdsJobClaim(db, { runId: created.id, runnerId: "runner-2" })).toBe(false);

    await db
      .update(schema.job)
      .set({ state: "queued", claimedByRunnerId: null })
      .where(eq(schema.job.id, claimed.id));

    expect(await holdsJobClaim(db, { runId: created.id, runnerId: "runner-1" })).toBe(false);
  });
});
