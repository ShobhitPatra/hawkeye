import {
  encodeMarker,
  findingId,
  type GitHubClient,
  GitHubRequestError,
  HAWKEYE_REPOSITORY_URL,
  type LivingRoundSummary,
  postRenderedReview,
  renderLivingReview,
  renderReview,
  type ReviewResult,
} from "@hawkeye/core";
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr as armedPrTable, job, reviewPosted, run } from "./db/schema";

export type ReviewPostingDeps = { db: Db; github: GitHubClient; log?: (line: string) => void };
export type ReviewPostingInput = {
  runId: string;
  armedPr: {
    id: string;
    userId: string;
    installationId: string;
    owner: string;
    repo: string;
    number: number;
  };
  headSha: string;
  result: ReviewResult;
  commentable: Record<string, number[]>;
};
export type ReviewPostingOutcome = "posted" | "already-posted" | "failed";

const STALE_RESERVATION_MS = 10 * 60 * 1000;

function toCommentableMap(commentable: Record<string, number[]>): Map<string, Set<number>> {
  return new Map(Object.entries(commentable).map(([path, lines]) => [path, new Set(lines)]));
}

function userPullRequest(armedPr: ReviewPostingInput["armedPr"]) {
  return and(
    eq(armedPrTable.userId, armedPr.userId),
    eq(armedPrTable.owner, armedPr.owner),
    eq(armedPrTable.repo, armedPr.repo),
    eq(armedPrTable.number, armedPr.number),
  );
}

async function livingReviewFor(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
): Promise<{ githubReviewId: string } | undefined> {
  const [row] = await db
    .select({ githubReviewId: reviewPosted.githubReviewId })
    .from(reviewPosted)
    .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
    .where(and(userPullRequest(armedPr), isNotNull(reviewPosted.githubReviewId)))
    .orderBy(asc(reviewPosted.postedAt))
    .limit(1);
  if (!row?.githubReviewId) return undefined;
  return { githubReviewId: row.githubReviewId };
}

async function previousRoundFindings(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
): Promise<{ previousIds: Set<string>; priorClaims: Record<string, string> }> {
  const [latest] = await db
    .select({ result: run.result })
    .from(reviewPosted)
    .innerJoin(run, eq(run.id, reviewPosted.runId))
    .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
    .where(and(userPullRequest(armedPr), isNotNull(reviewPosted.githubReviewId)))
    .orderBy(desc(reviewPosted.postedAt))
    .limit(1);
  if (!latest?.result) throw new Error("the living review has no run result behind it");
  const previousIds = new Set<string>();
  const priorClaims: Record<string, string> = {};
  for (const finding of latest.result.findings) {
    const id = findingId(finding.path, finding.claim);
    if (previousIds.has(id)) continue;
    previousIds.add(id);
    priorClaims[id] = finding.claim;
  }
  return { previousIds, priorClaims };
}

async function roundsFor(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
): Promise<LivingRoundSummary[]> {
  const rows = await db
    .select({ headSha: job.headSha, startedAt: run.startedAt, result: run.result })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .innerJoin(armedPrTable, eq(armedPrTable.id, job.armedPrId))
    .where(and(userPullRequest(armedPr), eq(run.status, "ok")))
    .orderBy(asc(run.startedAt));
  return rows.map((row, index) => {
    if (!row.result) throw new Error(`round ${index + 1} has an ok run without a result`);
    return {
      round: index + 1,
      headSha: row.headSha,
      verdict: row.result.verdict,
      startedAt: row.startedAt.toISOString(),
    };
  });
}

export async function postReviewForRun(
  deps: ReviewPostingDeps,
  input: ReviewPostingInput,
): Promise<ReviewPostingOutcome> {
  const { db, github } = deps;
  const log = deps.log ?? (() => {});
  const { armedPr, headSha } = input;
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${armedPr.owner}/${armedPr.repo}#${armedPr.number}@${headSha}`}, 0))`,
    );
    await tx
      .delete(reviewPosted)
      .where(
        and(
          eq(reviewPosted.armedPrId, armedPr.id),
          eq(reviewPosted.headSha, headSha),
          isNull(reviewPosted.githubReviewId),
          lt(reviewPosted.postedAt, new Date(Date.now() - STALE_RESERVATION_MS)),
        ),
      );
    const [postedForHead] = await tx
      .select({ id: reviewPosted.id })
      .from(reviewPosted)
      .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
      .where(
        and(
          eq(armedPrTable.owner, armedPr.owner),
          eq(armedPrTable.repo, armedPr.repo),
          eq(armedPrTable.number, armedPr.number),
          eq(reviewPosted.headSha, headSha),
        ),
      );
    if (postedForHead) return undefined;
    const [inserted] = await tx
      .insert(reviewPosted)
      .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: null })
      .onConflictDoNothing({ target: [reviewPosted.armedPrId, reviewPosted.headSha] })
      .returning({ id: reviewPosted.id });
    return inserted;
  });
  if (!reservation) return "already-posted";

  try {
    const token = await github.installationTokenById(armedPr.installationId);
    const reference = { owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number };
    const living = await livingReviewFor(db, armedPr);

    if (!living) {
      const render = (commentable: Map<string, Set<number>>) =>
        renderReview({
          result: input.result,
          headSha,
          commentable,
          repositoryUrl: HAWKEYE_REPOSITORY_URL,
        });
      const { posted } = await postRenderedReview({
        github,
        reference,
        token,
        review: render(toCommentableMap(input.commentable)),
        renderBodyOnly: () => render(new Map()),
        log,
      });
      await db
        .update(reviewPosted)
        .set({ githubReviewId: posted.id })
        .where(eq(reviewPosted.id, reservation.id));
      return "posted";
    }

    const { previousIds, priorClaims } = await previousRoundFindings(db, armedPr);
    const { body, comments } = renderLivingReview({
      result: input.result,
      headSha,
      commentable: toCommentableMap(input.commentable),
      repositoryUrl: HAWKEYE_REPOSITORY_URL,
      previousIds,
      priorClaims,
      rounds: await roundsFor(db, armedPr),
    });
    await github.updateReview(reference, living.githubReviewId, body, token);
    let roundReviewId = living.githubReviewId;
    if (comments.length > 0) {
      try {
        const supplemental = await github.postReview(
          reference,
          { event: "COMMENT", commit_id: headSha, body: encodeMarker(headSha), comments },
          token,
        );
        roundReviewId = supplemental.id;
      } catch (error) {
        if (!(error instanceof GitHubRequestError && error.status === 422)) throw error;
        log("inline anchors rejected (422); keeping every finding in the living body");
        const bodyOnly = renderLivingReview({
          result: input.result,
          headSha,
          commentable: new Map(),
          repositoryUrl: HAWKEYE_REPOSITORY_URL,
          previousIds,
          priorClaims,
          rounds: await roundsFor(db, armedPr),
        });
        await github.updateReview(reference, living.githubReviewId, bodyOnly.body, token);
      }
    }
    await db
      .update(reviewPosted)
      .set({ githubReviewId: roundReviewId })
      .where(eq(reviewPosted.id, reservation.id));
    return "posted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`review not posted for run ${input.runId}: ${message}`);
    await db.delete(reviewPosted).where(eq(reviewPosted.id, reservation.id));
    await db
      .update(run)
      .set({ error: `post: ${message}` })
      .where(eq(run.id, input.runId));
    return "failed";
  }
}
