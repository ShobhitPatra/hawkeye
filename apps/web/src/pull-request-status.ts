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

export type PullRequestStatus =
  | { kind: "armed" }
  | { kind: "queued" | "reviewing" | "failed"; last?: LastReview }
  | { kind: "reviewed"; last: LastReview };

type Arm = { id: string; userId: string; owner: string; repo: string; number: number };

export async function listPullRequestStatuses(
  db: Db,
  userId: string,
): Promise<Map<string, PullRequestStatus>> {
  const arms = await db
    .select({
      id: armedPr.id,
      userId: armedPr.userId,
      owner: armedPr.owner,
      repo: armedPr.repo,
      number: armedPr.number,
    })
    .from(armedPr)
    .where(and(eq(armedPr.userId, userId), isNull(armedPr.disarmedAt)));
  const entries = await Promise.all(
    arms.map(async (arm) => [armedPullRequestKey(arm), await statusOf(db, arm)] as const),
  );
  return new Map(entries);
}

function everyArmOf(arm: Arm) {
  return and(
    eq(armedPr.userId, arm.userId),
    eq(armedPr.owner, arm.owner),
    eq(armedPr.repo, arm.repo),
    eq(armedPr.number, arm.number),
  );
}

async function statusOf(db: Db, arm: Arm): Promise<PullRequestStatus> {
  const [openJobs, lastReview, latestRun] = await Promise.all([
    db
      .select({ state: job.state })
      .from(job)
      .where(and(eq(job.armedPrId, arm.id), inArray(job.state, ["queued", "claimed"]))),
    lastReviewOf(db, arm),
    db
      .select({ status: run.status })
      .from(run)
      .innerJoin(job, eq(job.id, run.jobId))
      .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
      .where(everyArmOf(arm))
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

async function lastReviewOf(db: Db, arm: Arm): Promise<LastReview | undefined> {
  const posted = await db
    .select({ result: run.result, endedAt: run.endedAt })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .innerJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .where(and(everyArmOf(arm), eq(run.status, "ok"), isNotNull(reviewPosted.githubReviewId)))
    .orderBy(desc(run.endedAt));
  const latest = posted[0];
  if (!latest?.result || !latest.endedAt) return undefined;
  const [open] = await db
    .select({ openFindings: count() })
    .from(finding)
    .innerJoin(armedPr, eq(armedPr.id, finding.armedPrId))
    .where(and(everyArmOf(arm), isNull(finding.resolvedSha)));
  return {
    verdict: latest.result.verdict,
    rounds: posted.length,
    openFindings: open?.openFindings ?? 0,
    reviewedAt: latest.endedAt,
  };
}
