import { SEVERITIES, type ReviewResult, type Severity, type Verdict } from "@hawkeye/core";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, finding, job, reviewPosted, run, runner } from "./db/schema";

export type PullRequestCoordinates = {
  userId: string;
  owner: string;
  repo: string;
  number: number;
};

export type PullRequestRun = {
  id: string;
  status: (typeof run.$inferSelect)["status"];
  verdict?: Verdict;
  reportedVerdict?: Verdict;
  turns: number;
  startedAt: Date;
  endedAt?: Date;
  error?: string;
  headSha: string;
  reviewUrl?: string;
  summary?: string;
  lenses?: ReviewResult["lenses"];
  runnerName?: string;
};

export type PullRequestFinding = {
  stableId: string;
  severity: Severity;
  claim: string;
  detail: string | null;
  path: string | null;
  line: number | null;
  firstSeenSha: string;
  resolvedSha: string | null;
};

export function userArmsOf(input: PullRequestCoordinates) {
  return and(
    eq(armedPr.userId, input.userId),
    eq(armedPr.owner, input.owner),
    eq(armedPr.repo, input.repo),
    eq(armedPr.number, input.number),
  );
}

export async function listRunsForPullRequest(
  db: Db,
  input: PullRequestCoordinates,
): Promise<PullRequestRun[]> {
  const rows = await db
    .select({
      id: run.id,
      status: run.status,
      turns: run.turns,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      error: run.error,
      result: run.result,
      headSha: job.headSha,
      githubReviewId: reviewPosted.githubReviewId,
      runnerName: runner.name,
    })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .innerJoin(runner, eq(runner.id, run.runnerId))
    .leftJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .where(userArmsOf(input))
    .orderBy(desc(run.startedAt));

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    turns: row.turns,
    startedAt: row.startedAt,
    headSha: row.headSha,
    runnerName: row.runnerName,
    ...(row.result
      ? { verdict: row.result.verdict, summary: row.result.summary, lenses: row.result.lenses }
      : {}),
    ...(row.result?.reportedVerdict ? { reportedVerdict: row.result.reportedVerdict } : {}),
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.githubReviewId
      ? {
          reviewUrl: `https://github.com/${input.owner}/${input.repo}/pull/${input.number}#pullrequestreview-${row.githubReviewId}`,
        }
      : {}),
  }));
}

export async function listFindingsForPullRequest(
  db: Db,
  input: PullRequestCoordinates,
): Promise<PullRequestFinding[]> {
  const rows = await db
    .select({
      stableId: finding.stableId,
      severity: finding.severity,
      claim: finding.claim,
      detail: finding.detail,
      path: finding.path,
      line: finding.line,
      firstSeenSha: finding.firstSeenSha,
      resolvedSha: finding.resolvedSha,
    })
    .from(finding)
    .innerJoin(armedPr, eq(armedPr.id, finding.armedPrId))
    .where(
      and(
        userArmsOf(input),
        eq(
          finding.armedPrId,
          db
            .select({ id: armedPr.id })
            .from(armedPr)
            .where(userArmsOf(input))
            .orderBy(desc(armedPr.armedAt))
            .limit(1),
        ),
      ),
    );

  return rows.toSorted(
    (a, b) =>
      Number(a.resolvedSha !== null) - Number(b.resolvedSha !== null) ||
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.claim.localeCompare(b.claim),
  );
}

export type ArmedPullRequestSummary = { id: string; installationId: string; armed: boolean };

export async function findArmedPullRequest(
  db: Db,
  input: PullRequestCoordinates,
): Promise<ArmedPullRequestSummary | undefined> {
  const [row] = await db
    .select({
      id: armedPr.id,
      installationId: armedPr.installationId,
      disarmedAt: armedPr.disarmedAt,
    })
    .from(armedPr)
    .where(userArmsOf(input))
    .orderBy(desc(armedPr.armedAt))
    .limit(1);
  return row
    ? { id: row.id, installationId: row.installationId, armed: row.disarmedAt === null }
    : undefined;
}
