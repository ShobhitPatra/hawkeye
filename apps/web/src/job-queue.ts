import type { ReviewResult, RunResultStatus } from "@hawkeye/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, job, run } from "./db/schema";
import type { Job } from "./jobs";

export type Run = typeof run.$inferSelect;

export const DEFAULT_STALE_AFTER_SECONDS = 300;

const queuedSibling = sql`exists (select 1
                                  from ${job} waiting
                                  where waiting.armed_pr_id = ${job.armedPrId}
                                    and waiting.state = 'queued')`;

export async function claimNextJob(
  db: Db,
  input: { runnerId: string; userId: string; now: Date },
): Promise<Job | undefined> {
  const [claimed] = await db
    .update(job)
    .set({
      state: "claimed",
      claimedByRunnerId: input.runnerId,
      claimedAt: input.now,
      heartbeatAt: input.now,
    })
    .where(
      eq(
        job.id,
        sql`(select next.id
             from ${job} next
             join ${armedPr} owner on owner.id = next.armed_pr_id
             where owner.user_id = ${input.userId}
               and owner.disarmed_at is null
               and next.state = 'queued'
               and next.not_before <= ${input.now}
             order by next.not_before
             for update of next skip locked
             limit 1)`,
      ),
    )
    .returning();
  return claimed;
}

export async function heartbeatJob(
  db: Db,
  input: { jobId: string; runnerId: string; now: Date },
): Promise<Job | undefined> {
  const [beat] = await db
    .update(job)
    .set({ heartbeatAt: input.now })
    .where(
      and(
        eq(job.id, input.jobId),
        eq(job.claimedByRunnerId, input.runnerId),
        eq(job.state, "claimed"),
      ),
    )
    .returning();
  return beat;
}

export async function requeueStaleJobs(
  db: Db,
  input: { now: Date; staleAfterSeconds?: number },
): Promise<number> {
  const cutoff = new Date(
    input.now.getTime() - (input.staleAfterSeconds ?? DEFAULT_STALE_AFTER_SECONDS) * 1000,
  );
  const swept = await db
    .update(job)
    .set({
      state: sql`(case
                    when ${queuedSibling}
                      or exists (select 1
                                 from ${job} newer
                                 where newer.armed_pr_id = ${job.armedPrId}
                                   and newer.state = 'claimed'
                                   and newer.heartbeat_at < ${cutoff}
                                   and (newer.created_at, newer.id) > (${job.createdAt}, ${job.id}))
                    then 'failed'
                    else 'queued'
                  end)::job_state`,
      claimedByRunnerId: null,
      claimedAt: null,
      heartbeatAt: null,
    })
    .where(and(eq(job.state, "claimed"), sql`${job.heartbeatAt} < ${cutoff}`))
    .returning({ id: job.id });
  if (swept.length === 0) return 0;

  await db
    .update(run)
    .set({ status: "error", error: "heartbeat lost", endedAt: input.now })
    .where(
      and(
        inArray(
          run.jobId,
          swept.map((row) => row.id),
        ),
        eq(run.status, "running"),
      ),
    );
  return swept.length;
}

export async function releaseJob(
  db: Db,
  input: { jobId: string; runId: string; runnerId: string; error: string; now: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(job)
      .set({
        state: sql`(case when ${queuedSibling} then 'failed' else 'queued' end)::job_state`,
        claimedByRunnerId: null,
        claimedAt: null,
        heartbeatAt: null,
      })
      .where(
        and(
          eq(job.id, input.jobId),
          eq(job.claimedByRunnerId, input.runnerId),
          eq(job.state, "claimed"),
        ),
      );
    await tx
      .update(run)
      .set({ status: "error", error: input.error, endedAt: input.now })
      .where(and(eq(run.id, input.runId), eq(run.status, "running")));
  });
}

export async function createRun(db: Db, input: { jobId: string; runnerId: string }): Promise<Run> {
  const [created] = await db
    .insert(run)
    .values({ jobId: input.jobId, runnerId: input.runnerId })
    .returning();
  if (!created) throw new Error(`failed to create a run for job ${input.jobId}`);
  return created;
}

export async function holdsJobClaim(
  db: Db,
  input: { runId: string; runnerId: string },
): Promise<boolean> {
  const [held] = await db
    .select({ id: run.id })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .where(
      and(
        eq(run.id, input.runId),
        eq(run.runnerId, input.runnerId),
        eq(job.state, "claimed"),
        eq(job.claimedByRunnerId, input.runnerId),
      ),
    );
  return held !== undefined;
}

export async function completeRun(
  db: Db,
  input: {
    runId: string;
    runnerId: string;
    status: RunResultStatus;
    turns: number;
    result?: ReviewResult;
    error?: string;
  },
): Promise<Run | undefined> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(job)
      .set({ state: input.status === "ok" ? "done" : "failed" })
      .where(
        and(
          eq(job.claimedByRunnerId, input.runnerId),
          eq(job.state, "claimed"),
          sql`${job.id} = (select owner.job_id
                           from ${run} owner
                           where owner.id = ${input.runId}
                             and owner.runner_id = ${input.runnerId}
                             and owner.status = 'running')`,
        ),
      )
      .returning({ id: job.id });
    if (!claimed) return undefined;

    const [completed] = await tx
      .update(run)
      .set({
        status: input.status,
        turns: input.turns,
        result: input.status === "ok" ? (input.result ?? null) : null,
        error: input.error ?? null,
        endedAt: new Date(),
      })
      .where(
        and(eq(run.id, input.runId), eq(run.runnerId, input.runnerId), eq(run.status, "running")),
      )
      .returning();
    return completed;
  });
}
