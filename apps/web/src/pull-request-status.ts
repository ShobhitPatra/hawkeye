import type { Verdict } from "@hawkeye/core";
import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { armedPullRequestKey } from "./arming";
import type { Db } from "./db/client";
import { armedPr, finding, job, reviewPosted, run } from "./db/schema";

export type LastReview = {
  verdict: Verdict;
  rounds: number;
  openFindings: number;
  reviewedAt: Date;
};

export type PullRequestStatus = {
  kind: "armed" | "queued" | "reviewing" | "failed" | "reviewed";
  last?: LastReview;
};

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
  const [openJobs, lastReview, latestRun] = await Promise.all([
    db
      .select({ state: job.state })
      .from(job)
      .where(and(eq(job.armedPrId, armedPrId), inArray(job.state, ["queued", "claimed"]))),
    lastReviewOf(db, armedPrId),
    db
      .select({ status: run.status })
      .from(run)
      .innerJoin(job, eq(job.id, run.jobId))
      .where(eq(job.armedPrId, armedPrId))
      .orderBy(desc(run.startedAt))
      .limit(1),
  ]);
  const last = lastReview ? { last: lastReview } : {};
  if (openJobs.some((row) => row.state === "claimed")) return { kind: "reviewing", ...last };
  if (openJobs.length > 0) return { kind: "queued", ...last };
  const latest = latestRun[0];
  if (!latest) return { kind: "armed" };
  if (latest.status === "running") return { kind: "reviewing", ...last };
  if (latest.status !== "ok" || !lastReview) return { kind: "failed", ...last };
  return { kind: "reviewed", last: lastReview };
}

async function lastReviewOf(db: Db, armedPrId: string): Promise<LastReview | undefined> {
  const posted = await db
    .select({ result: run.result, endedAt: run.endedAt })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .where(
      and(
        eq(job.armedPrId, armedPrId),
        eq(run.status, "ok"),
        isNotNull(reviewPosted.githubReviewId),
      ),
    )
    .orderBy(desc(run.endedAt));
  const latest = posted[0];
  if (!latest?.result || !latest.endedAt) return undefined;
  const [open] = await db
    .select({ openFindings: count() })
    .from(finding)
    .where(and(eq(finding.armedPrId, armedPrId), isNull(finding.resolvedSha)));
  return {
    verdict: latest.result.verdict,
    rounds: posted.length,
    openFindings: open?.openFindings ?? 0,
    reviewedAt: latest.endedAt,
  };
}
