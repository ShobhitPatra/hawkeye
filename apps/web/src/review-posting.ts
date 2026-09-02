import {
  encodeMarker,
  findingId,
  type GitHubClient,
  GitHubRequestError,
  HAWKEYE_REPOSITORY_URL,
  type RoundSummary,
  postRenderedReview,
  renderLivingReview,
  renderReview,
  type ReviewResult,
} from "@hawkeye/core";
import { and, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr as armedPrTable, job, reviewPosted, run } from "./db/schema";
import { supersededBy } from "./findings";

export type ReviewPostingDeps = { db: Db; github: GitHubClient; log?: (line: string) => void };
export type ReviewPostingInput = {
  runId: string;
  jobId: string;
  armedPr: { id: string; installationId: string; owner: string; repo: string; number: number };
  headSha: string;
  result: ReviewResult;
  commentable: Record<string, number[]>;
};
export type ReviewPostingOutcome = "posted" | "already-posted" | "superseded" | "failed";

function toCommentableMap(commentable: Record<string, number[]>): Map<string, Set<number>> {
  return new Map(Object.entries(commentable).map(([path, lines]) => [path, new Set(lines)]));
}

function samePullRequest(armedPr: ReviewPostingInput["armedPr"]) {
  return and(
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
    .where(and(samePullRequest(armedPr), isNotNull(reviewPosted.githubReviewId)))
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
    .where(and(samePullRequest(armedPr), isNotNull(reviewPosted.githubReviewId)))
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
  currentRunId: string,
): Promise<RoundSummary[]> {
  const rows = await db
    .select({ headSha: job.headSha, startedAt: run.startedAt, result: run.result })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .innerJoin(armedPrTable, eq(armedPrTable.id, job.armedPrId))
    .where(
      and(
        samePullRequest(armedPr),
        eq(run.status, "ok"),
        or(isNotNull(reviewPosted.githubReviewId), eq(run.id, currentRunId)),
      ),
    )
    .orderBy(asc(run.startedAt));
  return rows.map((row, index) => {
    if (!row.result) throw new Error(`round ${index + 1} has an ok run without a result`);
    return {
      round: index + 1,
      headSha: row.headSha,
      verdict: row.result.verdict,
      startedAt: `${row.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    };
  });
}

export async function postReviewForRun(
  deps: ReviewPostingDeps,
  input: ReviewPostingInput,
): Promise<ReviewPostingOutcome> {
  const { github } = deps;
  const log = deps.log ?? (() => {});
  const { armedPr, headSha } = input;
  return deps.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${armedPr.owner}/${armedPr.repo}#${armedPr.number}`}, 0))`,
    );
    const [postedForHead] = await tx
      .select({ id: reviewPosted.id })
      .from(reviewPosted)
      .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
      .where(and(samePullRequest(armedPr), eq(reviewPosted.headSha, headSha)))
      .limit(1);
    if (postedForHead) return "already-posted";
    if (await supersededBy(tx, input.jobId)) return "superseded";
    const [reservation] = await tx
      .insert(reviewPosted)
      .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: null })
      .returning({ id: reviewPosted.id });
    if (!reservation) throw new Error("the review reservation was not inserted");
    const record = (githubReviewId: string) =>
      tx.update(reviewPosted).set({ githubReviewId }).where(eq(reviewPosted.id, reservation.id));

    let githubWrote = false;
    try {
      const token = await github.installationTokenById(armedPr.installationId);
      const reference = { owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number };
      const living = await livingReviewFor(tx, armedPr);

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
        githubWrote = true;
        await record(posted.id);
        return "posted";
      }

      const { previousIds, priorClaims } = await previousRoundFindings(tx, armedPr);
      const rounds = await roundsFor(tx, armedPr, input.runId);
      const render = (map: Map<string, Set<number>>) =>
        renderLivingReview({
          result: input.result,
          headSha,
          commentable: map,
          repositoryUrl: HAWKEYE_REPOSITORY_URL,
          previousIds,
          priorClaims,
          rounds,
        });
      const inline = render(toCommentableMap(input.commentable));
      let finalBody = inline.body;
      let supplementalPosted = false;
      if (inline.comments.length > 0) {
        try {
          const supplemental = await github.postReview(
            reference,
            {
              event: "COMMENT",
              commit_id: headSha,
              body: encodeMarker(headSha),
              comments: inline.comments,
            },
            token,
          );
          githubWrote = true;
          await record(supplemental.id);
          supplementalPosted = true;
        } catch (error) {
          if (!(error instanceof GitHubRequestError && error.status === 422)) throw error;
          log(
            `supplemental review rejected (${error.message}); keeping every finding in the living body`,
          );
          finalBody = render(new Map()).body;
        }
      }
      await github.updateReview(reference, living.githubReviewId, finalBody, token);
      githubWrote = true;
      if (!supplementalPosted) await record(living.githubReviewId);
      return "posted";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`review not posted for run ${input.runId}: ${message}`);
      if (!githubWrote) await tx.delete(reviewPosted).where(eq(reviewPosted.id, reservation.id));
      await tx
        .update(run)
        .set({ error: `post: ${message}` })
        .where(eq(run.id, input.runId));
      return "failed";
    }
  });
}
