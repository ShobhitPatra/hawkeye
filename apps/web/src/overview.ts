import { SEVERITIES, type Verdict } from "@hawkeye/core";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, finding, job, reviewPosted, run } from "./db/schema";

export type Totals = {
  reviews: number;
  pullRequests: number;
  findings: number;
  addressed: number;
  mustFix: number;
  turns: number;
  seconds: number;
};

export type RecentReview = {
  owner: string;
  repo: string;
  number: number;
  installationId: string;
  title?: string;
  verdict: Verdict;
  turns: number;
  endedAt: Date;
};

export type Overview = {
  allTime: Totals;
  thisMonth: Totals;
  reviewsByDay: Map<string, number>;
  recent: RecentReview[];
};

const EMPTY: Totals = {
  reviews: 0,
  pullRequests: 0,
  findings: 0,
  addressed: 0,
  mustFix: 0,
  turns: 0,
  seconds: 0,
};

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function loadOverview(db: Db, userId: string, now: Date): Promise<Overview> {
  const [reviews, findings] = await Promise.all([
    postedReviews(db, userId),
    findingRows(db, userId),
  ]);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const yearStart = new Date(now.getTime() - 364 * 24 * 60 * 60 * 1000);

  const reviewsByDay = new Map<string, number>();
  for (const review of reviews) {
    if (review.endedAt < yearStart) continue;
    const key = dayKey(review.endedAt);
    reviewsByDay.set(key, (reviewsByDay.get(key) ?? 0) + 1);
  }

  return {
    allTime: totals(reviews, findings),
    thisMonth: totals(
      reviews.filter((review) => review.endedAt >= monthStart),
      findings.filter((row) => row.raisedAt !== undefined && row.raisedAt >= monthStart),
    ),
    reviewsByDay,
    recent: reviews
      .slice(0, 5)
      .map(({ owner, repo, number, installationId, verdict, turns, endedAt }) => ({
        owner,
        repo,
        number,
        installationId,
        verdict,
        turns,
        endedAt,
      })),
  };
}

type PostedReview = RecentReview & { seconds: number; headSha: string; armedPrId: string };
type FindingRow = { severity: (typeof SEVERITIES)[number]; resolved: boolean; raisedAt?: Date };

function totals(reviews: PostedReview[], findings: FindingRow[]): Totals {
  if (reviews.length === 0 && findings.length === 0) return EMPTY;
  return {
    reviews: reviews.length,
    pullRequests: new Set(reviews.map((r) => `${r.owner}/${r.repo}#${r.number}`)).size,
    findings: findings.length,
    addressed: findings.filter((f) => f.resolved).length,
    mustFix: findings.filter((f) => f.severity === "must_fix").length,
    turns: reviews.reduce((sum, r) => sum + r.turns, 0),
    seconds: reviews.reduce((sum, r) => sum + r.seconds, 0),
  };
}

async function postedReviews(db: Db, userId: string): Promise<PostedReview[]> {
  const rows = await db
    .select({
      owner: armedPr.owner,
      repo: armedPr.repo,
      number: armedPr.number,
      installationId: armedPr.installationId,
      armedPrId: armedPr.id,
      headSha: job.headSha,
      result: run.result,
      turns: run.turns,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .innerJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .where(
      and(
        eq(armedPr.userId, userId),
        eq(run.status, "ok"),
        isNotNull(reviewPosted.githubReviewId),
        isNotNull(run.endedAt),
      ),
    )
    .orderBy(desc(run.endedAt));
  return rows.flatMap((row) =>
    row.result && row.endedAt
      ? [
          {
            owner: row.owner,
            repo: row.repo,
            number: row.number,
            installationId: row.installationId,
            armedPrId: row.armedPrId,
            headSha: row.headSha,
            verdict: row.result.verdict,
            turns: row.turns,
            endedAt: row.endedAt,
            seconds: Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000),
          },
        ]
      : [],
  );
}

async function findingRows(db: Db, userId: string): Promise<FindingRow[]> {
  const rows = await db
    .select({
      severity: finding.severity,
      resolvedSha: finding.resolvedSha,
      firstSeenSha: finding.firstSeenSha,
      armedPrId: finding.armedPrId,
    })
    .from(finding)
    .innerJoin(armedPr, eq(armedPr.id, finding.armedPrId))
    .where(eq(armedPr.userId, userId));
  if (rows.length === 0) return [];
  const runs = await db
    .select({ armedPrId: job.armedPrId, headSha: job.headSha, endedAt: run.endedAt })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .where(and(eq(armedPr.userId, userId), eq(run.status, "ok"), isNotNull(run.endedAt)));
  const raisedAt = new Map<string, Date>();
  for (const row of runs) {
    if (!row.endedAt) continue;
    const key = `${row.armedPrId}:${row.headSha}`;
    const seen = raisedAt.get(key);
    if (!seen || row.endedAt < seen) raisedAt.set(key, row.endedAt);
  }
  return rows.map((row) => {
    const at = raisedAt.get(`${row.armedPrId}:${row.firstSeenSha}`);
    return {
      severity: row.severity,
      resolved: row.resolvedSha !== null,
      ...(at ? { raisedAt: at } : {}),
    };
  });
}
