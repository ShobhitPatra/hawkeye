import type { Verdict } from "@hawkeye/core";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { armedPullRequestKey } from "./arming";
import type { Db } from "./db/client";
import { armedPr, finding, job, run } from "./db/schema";

export type PullRequestStatus =
  | { kind: "armed" }
  | { kind: "queued" }
  | { kind: "reviewing" }
  | { kind: "failed"; rounds: number; reviewedAt?: Date }
  | { kind: "reviewed"; verdict: Verdict; rounds: number; openFindings: number; reviewedAt: Date };

export async function listPullRequestStatuses(
  db: Db,
  userId: string,
): Promise<Map<string, PullRequestStatus>> {
  const arms = await db
    .select({ id: armedPr.id, owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number })
    .from(armedPr)
    .where(and(eq(armedPr.userId, userId), isNull(armedPr.disarmedAt)));
  const entries = await Promise.all(
    arms.map(async (arm) => [armedPullRequestKey(arm), await statusOf(db, arm.id)] as const),
  );
  return new Map(entries);
}

async function statusOf(db: Db, armedPrId: string): Promise<PullRequestStatus> {
  const [latestJob] = await db
    .select({ id: job.id, state: job.state })
    .from(job)
    .where(eq(job.armedPrId, armedPrId))
    .orderBy(desc(job.updatedAt), desc(job.notBefore))
    .limit(1);
  if (!latestJob) return { kind: "armed" };
  if (latestJob.state === "queued") return { kind: "queued" };
  if (latestJob.state === "claimed") return { kind: "reviewing" };

  const runs = await db
    .select({ status: run.status, result: run.result, endedAt: run.endedAt })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .where(eq(job.armedPrId, armedPrId))
    .orderBy(desc(run.startedAt));
  const completed = runs.filter((row) => row.status !== "running");
  const latest = completed[0];
  const rounds = completed.length;
  if (!latest || latest.status !== "ok" || !latest.result || !latest.endedAt)
    return { kind: "failed", rounds, ...(latest?.endedAt ? { reviewedAt: latest.endedAt } : {}) };

  const [open] = await db
    .select({ openFindings: count() })
    .from(finding)
    .where(and(eq(finding.armedPrId, armedPrId), isNull(finding.resolvedSha)));
  return {
    kind: "reviewed",
    verdict: latest.result.verdict,
    rounds,
    openFindings: open?.openFindings ?? 0,
    reviewedAt: latest.endedAt,
  };
}
