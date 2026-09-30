import type { ReviewResult } from "@hawkeye/core";
import { eq, sql, type SQLWrapper } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import {
  claimNextJob,
  claimNextJobStatement,
  completeRun,
  createRun,
  heartbeatJob,
  holdsJobClaim,
  jobSupersededStatement,
  releaseJob,
  requeueStaleJobs,
  requeueStaleJobsStatement,
  takeBackClaim,
} from "./job-queue";
import { createTestDb, seedArmedPullRequest, queueJob } from "./test/pglite";

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
  return queueJob(db, {
    headCurrentAt: new Date(),
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

describe("the queue's indexes", () => {
  async function seedQueue() {
    await db.execute(
      sql`insert into "user" (id, name, email)
          select 'seed-u' || g, 'n', 'seed' || g || '@example.com' from generate_series(1, 200) g`,
    );
    await db.execute(
      sql`insert into armed_pr (id, user_id, installation_id, owner, repo, number)
          select 'seed-a' || g, 'seed-u' || (1 + g % 200), '10', 'seed', 'r' || g, g
          from generate_series(1, 800) g`,
    );
    await db.execute(
      sql`insert into job (armed_pr_id, head_sha, base_sha, not_before, state)
          select 'seed-a' || (1 + g % 800), 'h' || g, 'b', now() - interval '1 hour',
                 (case when g % 10 = 0 then 'failed' else 'done' end)::job_state
          from generate_series(1, 20000) g`,
    );
    await db.execute(
      sql`insert into job (armed_pr_id, head_sha, base_sha, not_before, state)
          select 'seed-a' || g, 'q' || g, 'b', now() - interval '1 minute', 'queued'
          from generate_series(1, 40) g`,
    );
    await db.execute(
      sql`insert into job (armed_pr_id, head_sha, base_sha, not_before, state, heartbeat_at)
          select 'seed-a' || (100 + g), 'c' || g, 'b', now() - interval '1 hour', 'claimed',
                 now() - (g || ' minutes')::interval
          from generate_series(1, 30) g`,
    );
    await db.execute(sql`analyze`);
  }

  async function plan(statement: SQLWrapper): Promise<string> {
    const result = (await db.execute(sql`explain `.append(statement.getSQL()))) as {
      rows: { "QUERY PLAN": string }[];
    };
    return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  }

  it("serves the claim from job_claimable and the stale sweep from job_stale, never a full scan", async () => {
    await seedQueue();
    const claimStatement = claimNextJobStatement(db, {
      runnerId: "runner-1",
      userId: "seed-u5",
      now: new Date(),
    });
    const claimPlan = await plan(claimStatement);
    expect(claimPlan).not.toContain("Seq Scan on job");
    expect(claimPlan).toContain("job_claimable");
    const sweep = requeueStaleJobsStatement(db, new Date(Date.now() - 5 * 60_000));
    const sweepPlan = await plan(sweep);
    expect(sweepPlan).not.toContain("Seq Scan on job");
    expect(sweepPlan).toContain("job_stale");
    const ownSweep = requeueStaleJobsStatement(db, new Date(Date.now() - 5 * 60_000), "seed-u5");
    const ownSweepPlan = await plan(ownSweep);
    expect(ownSweepPlan).not.toContain("Seq Scan on job");
    expect(ownSweepPlan).toContain("job_stale");
    const supersededPlan = await plan(
      jobSupersededStatement(db, { id: "any-job", armedPrId: "seed-a5" }),
    );
    expect(supersededPlan).not.toContain("Seq Scan on job");
    expect(supersededPlan).toContain("job_by_armed_pr");
  });
});

describe("requeueStaleJobs", () => {
  it("requeues a claim whose heartbeat went silent", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });

    expect((await requeueStaleJobs(db, { now })).swept).toBe(1);

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

    expect((await requeueStaleJobs(db, { now })).swept).toBe(1);

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

    expect((await requeueStaleJobs(db, { now })).swept).toBe(1);

    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, finished.id));
    expect(row).toMatchObject({ status: "ok", error: null });
  });

  it("leaves a live claim alone", async () => {
    const live = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: live.id, runnerId: "runner-1", now: minutesBefore(1) });

    expect((await requeueStaleJobs(db, { now })).swept).toBe(0);

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, live.id));
    expect(row?.state).toBe("claimed");
  });

  it("fails a stale claim that a newer queued job has superseded", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });
    const fresh = await enqueue("armed-1", minutesBefore(1));

    expect((await requeueStaleJobs(db, { now })).swept).toBe(1);

    const rows = await db.select().from(schema.job).where(eq(schema.job.armedPrId, "armed-1"));
    expect(rows.find((row) => row.id === stale.id)?.state).toBe("failed");
    expect(rows.find((row) => row.id === fresh.id)?.state).toBe("queued");
  });

  it("requeues only the newest of two stale claims for one pull request", async () => {
    const older = await enqueue("armed-1", minutesBefore(20));
    await claim("runner-1");
    const newer = await enqueue("armed-1", minutesBefore(10));
    await claim("runner-2");
    await db
      .update(schema.job)
      .set({ heartbeatAt: minutesBefore(6), createdAt: minutesBefore(20) })
      .where(eq(schema.job.id, older.id));
    await db
      .update(schema.job)
      .set({ heartbeatAt: minutesBefore(6), createdAt: minutesBefore(10) })
      .where(eq(schema.job.id, newer.id));

    expect((await requeueStaleJobs(db, { now })).swept).toBe(2);

    const rows = await db.select().from(schema.job).where(eq(schema.job.armedPrId, "armed-1"));
    expect(rows.find((row) => row.id === newer.id)?.state).toBe("queued");
    expect(rows.find((row) => row.id === older.id)).toMatchObject({
      state: "failed",
      claimedByRunnerId: null,
      claimedAt: null,
      heartbeatAt: null,
    });
  });

  it("requeues stale claims of unrelated pull requests side by side", async () => {
    const one = await enqueue("armed-1", minutesBefore(20));
    await claim("runner-1");
    const two = await enqueue("armed-2", minutesBefore(10));
    await claim("runner-2");
    await db.update(schema.job).set({ heartbeatAt: minutesBefore(6) });

    expect((await requeueStaleJobs(db, { now })).swept).toBe(2);

    const rows = await db.select().from(schema.job);
    expect(rows.find((row) => row.id === one.id)?.state).toBe("queued");
    expect(rows.find((row) => row.id === two.id)?.state).toBe("queued");
  });

  it("fails a stale claim once its pull request moved to a newer head, claimed or finished", async () => {
    for (const newer of ["claimed", "done"] as const) {
      const stale = await enqueue("armed-1", minutesBefore(10));
      await claim();
      await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });
      const later = await queueJob(db, {
        headCurrentAt: new Date(),
        armedPrId: "armed-1",
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40),
        notBefore: minutesBefore(5),
      });
      if (newer === "claimed") await claim("runner-2");
      else await db.update(schema.job).set({ state: "done" }).where(eq(schema.job.id, later.id));

      expect((await requeueStaleJobs(db, { now })).swept).toBe(1);

      const [row] = await db.select().from(schema.job).where(eq(schema.job.id, stale.id));
      expect(row?.state, newer).toBe("failed");
      await db.delete(schema.job);
    }
  });

  it("puts back only the named user's stale claims when scoped to one", async () => {
    await db
      .insert(schema.runner)
      .values({ id: "runner-3", userId: "user-2", name: "desk", tokenHash: "hash-3" });
    const mine = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const theirs = await enqueue("armed-3", minutesBefore(10));
    await claim("runner-3", "user-2");
    await heartbeatJob(db, { jobId: mine.id, runnerId: "runner-1", now: minutesBefore(6) });
    await heartbeatJob(db, { jobId: theirs.id, runnerId: "runner-3", now: minutesBefore(6) });

    expect((await requeueStaleJobs(db, { now, userId: "user-1" })).swept).toBe(1);

    const rows = await db.select().from(schema.job);
    expect(rows.find((row) => row.id === mine.id)?.state).toBe("queued");
    expect(rows.find((row) => row.id === theirs.id)?.state).toBe("claimed");
  });

  it("honours a custom staleness window", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(2) });

    expect((await requeueStaleJobs(db, { now, staleAfterSeconds: 60 })).swept).toBe(1);
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
      headSha: "a".repeat(40),
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

  it("changes nothing when the job is no longer claimed", async () => {
    const claimed = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const created = await createRun(db, { jobId: claimed.id, runnerId: "runner-1" });
    await db
      .update(schema.job)
      .set({ state: "queued", claimedByRunnerId: null })
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
    expect(row).toMatchObject({ status: "running", endedAt: null });
  });

  it("leaves another job claimed by the same runner untouched", async () => {
    const mine = await enqueue("armed-1", minutesBefore(10));
    await claim("runner-1");
    const created = await createRun(db, { jobId: mine.id, runnerId: "runner-1" });
    const other = await enqueue("armed-2", minutesBefore(5));
    await claim("runner-1");

    await completeRun(db, {
      runId: created.id,
      runnerId: "runner-1",
      status: "ok",
      turns: 1,
      result: reviewResult,
    });

    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, other.id));
    expect(row?.state).toBe("claimed");
  });
});

describe("takeBackClaim", () => {
  async function lostClaim() {
    const queued = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const lost = await createRun(db, { jobId: queued.id, runnerId: "runner-1" });
    await heartbeatJob(db, { jobId: queued.id, runnerId: "runner-1", now: minutesBefore(6) });
    await requeueStaleJobs(db, { now });
    return { jobId: queued.id, runId: lost.id };
  }

  async function rows(lost: { jobId: string; runId: string }) {
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, lost.jobId));
    const [runRow] = await db.select().from(schema.run).where(eq(schema.run.id, lost.runId));
    return { job: jobRow, run: runRow };
  }

  const untouched = {
    job: { state: "queued", claimedByRunnerId: null },
    run: { status: "error", error: "heartbeat lost" },
  };

  it("gives the claim back for the run that lost its heartbeat while the job still waits", async () => {
    const lost = await lostClaim();

    const taken = await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now });

    expect(taken?.id).toBe(lost.jobId);
    expect(await rows(lost)).toMatchObject({
      job: { state: "claimed", claimedByRunnerId: "runner-1", claimedAt: now, heartbeatAt: now },
      run: { status: "running", error: null, endedAt: null },
    });
  });

  it("gives the claim back by job when the lost run is the job's last", async () => {
    const lost = await lostClaim();
    const earlier = await createRun(db, { jobId: lost.jobId, runnerId: "runner-1" });
    await db
      .update(schema.run)
      .set({ status: "error", error: "heartbeat lost", startedAt: minutesBefore(60) })
      .where(eq(schema.run.id, earlier.id));

    const taken = await takeBackClaim(db, { jobId: lost.jobId, runnerId: "runner-1", now });

    expect(taken?.id).toBe(lost.jobId);
    expect((await rows(lost)).run).toMatchObject({ status: "running", error: null });
    const [older] = await db.select().from(schema.run).where(eq(schema.run.id, earlier.id));
    expect(older).toMatchObject({ status: "error", error: "heartbeat lost" });
  });

  it("refuses another runner", async () => {
    const lost = await lostClaim();

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-2", now }),
    ).toBeUndefined();
    expect(
      await takeBackClaim(db, { jobId: lost.jobId, runnerId: "runner-2", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
  });

  it("refuses once the job was claimed again", async () => {
    const lost = await lostClaim();
    await claim("runner-2");

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject({
      job: { state: "claimed", claimedByRunnerId: "runner-2" },
      run: untouched.run,
    });
  });

  it("refuses once another claim was released back to the queue", async () => {
    const lost = await lostClaim();
    await claim("runner-2");
    const released = await createRun(db, { jobId: lost.jobId, runnerId: "runner-2" });
    await db
      .update(schema.run)
      .set({ startedAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.run.id, released.id));
    await releaseJob(db, {
      jobId: lost.jobId,
      runId: released.id,
      runnerId: "runner-2",
      error: "installation token",
      now,
    });

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(
      await takeBackClaim(db, { jobId: lost.jobId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
  });

  it("refuses an earlier lost run once the same runner lost a later one", async () => {
    const lost = await lostClaim();
    const earlier = await createRun(db, { jobId: lost.jobId, runnerId: "runner-1" });
    await db
      .update(schema.run)
      .set({ status: "error", error: "heartbeat lost", startedAt: minutesBefore(60) })
      .where(eq(schema.run.id, earlier.id));

    expect(
      await takeBackClaim(db, { runId: earlier.id, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
  });

  it("refuses once a push moved the waiting job to a newer head", async () => {
    const lost = await lostClaim();
    await queueJob(db, {
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      headCurrentAt: new Date(Date.now() + 60_000),
      notBefore: minutesBefore(1),
    });

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject({
      job: { ...untouched.job, headSha: "c".repeat(40) },
      run: untouched.run,
    });
  });

  it("refuses once the waiting job was asked to review from scratch", async () => {
    const lost = await lostClaim();
    await queueJob(db, {
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      headCurrentAt: new Date(Date.now() + 60_000),
      notBefore: minutesBefore(1),
      fromScratch: true,
    });

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
  });

  it("refuses once the pull request's reviews were paused", async () => {
    const lost = await lostClaim();
    await db
      .update(schema.armedPr)
      .set({ disarmedAt: now })
      .where(eq(schema.armedPr.id, "armed-1"));

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
  });

  it("refuses a job the sweep failed because a newer one overtook it", async () => {
    const stale = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const lost = await createRun(db, { jobId: stale.id, runnerId: "runner-1" });
    await heartbeatJob(db, { jobId: stale.id, runnerId: "runner-1", now: minutesBefore(6) });
    await enqueue("armed-1", minutesBefore(1));
    await requeueStaleJobs(db, { now });

    expect(await takeBackClaim(db, { runId: lost.id, runnerId: "runner-1", now })).toBeUndefined();
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, stale.id));
    expect(jobRow?.state).toBe("failed");
  });

  it("refuses a run that ended for another reason", async () => {
    const queued = await enqueue("armed-1", minutesBefore(10));
    await claim();
    const released = await createRun(db, { jobId: queued.id, runnerId: "runner-1" });
    await releaseJob(db, {
      jobId: queued.id,
      runId: released.id,
      runnerId: "runner-1",
      error: "installation token",
      now,
    });

    expect(
      await takeBackClaim(db, { runId: released.id, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(
      await takeBackClaim(db, { jobId: queued.id, runnerId: "runner-1", now }),
    ).toBeUndefined();
  });

  it("refuses a run that was opened before runs recorded their head", async () => {
    const lost = await lostClaim();
    await db.update(schema.run).set({ headSha: null }).where(eq(schema.run.id, lost.runId));

    expect(
      await takeBackClaim(db, { runId: lost.runId, runnerId: "runner-1", now }),
    ).toBeUndefined();
    expect(await rows(lost)).toMatchObject(untouched);
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
