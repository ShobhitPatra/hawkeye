import type { PullRequestReference } from "@hawkeye/core";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, job, runner } from "./db/schema";

export const RUNNER_ONLINE_WINDOW_MS = 90 * 1000;

export type RunnerStatus = { online: boolean; lastSeenAt?: Date; waitingJobs: number };

export async function runnerStatus(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<RunnerStatus> {
  const [latest] = await db
    .select({ lastSeenAt: runner.lastSeenAt })
    .from(runner)
    .where(and(eq(runner.userId, userId), isNull(runner.revokedAt), isNotNull(runner.lastSeenAt)))
    .orderBy(desc(runner.lastSeenAt))
    .limit(1);
  const [waiting] = await db
    .select({ waitingJobs: count() })
    .from(job)
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .where(and(eq(armedPr.userId, userId), isNull(armedPr.disarmedAt), eq(job.state, "queued")));

  const lastSeenAt = latest?.lastSeenAt ?? undefined;
  return {
    online:
      lastSeenAt !== undefined && now.getTime() - lastSeenAt.getTime() <= RUNNER_ONLINE_WINDOW_MS,
    ...(lastSeenAt ? { lastSeenAt } : {}),
    waitingJobs: waiting?.waitingJobs ?? 0,
  };
}

export function describeRunnerStatus(status: RunnerStatus): string {
  return status.online ? "Runner online" : `Runner offline, ${status.waitingJobs} waiting`;
}

export async function reviewingByRunner(
  db: Db,
  userId: string,
): Promise<Map<string, PullRequestReference>> {
  const rows = await db
    .select({
      runnerId: job.claimedByRunnerId,
      owner: armedPr.owner,
      repo: armedPr.repo,
      number: armedPr.number,
    })
    .from(job)
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .where(
      and(eq(armedPr.userId, userId), eq(job.state, "claimed"), isNotNull(job.claimedByRunnerId)),
    );
  return new Map(
    rows.flatMap((row) =>
      row.runnerId
        ? [[row.runnerId, { owner: row.owner, repo: row.repo, number: row.number }] as const]
        : [],
    ),
  );
}
