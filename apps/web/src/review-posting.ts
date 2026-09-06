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
import { and, asc, desc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./db/client";
import { armedPr as armedPrTable, job, reviewPosted, run } from "./db/schema";
import {
  ALREADY_POSTED_BODY,
  clearReviewing,
  NOT_COMPLETED_BODY,
  SUPERSEDED_BODY,
} from "./reviewing-line";

export type ReviewPostingDeps = { db: Db; github: GitHubClient; log?: (line: string) => void };
export type ReviewPostingInput = {
  runId: string;
  jobId: string;
  armedPr: { id: string; installationId: string; owner: string; repo: string; number: number };
  headSha: string;
  result: ReviewResult;
  commentable: Record<string, number[]>;
  turns?: number;
};
export type ReviewPostingOutcome = "posted" | "already-posted" | "superseded" | "failed";

const STALE_RESERVATION_MS = 10 * 60 * 1000;

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

export async function livingReviewFor(
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

async function placeholderFor(
  db: Db,
  runId: string,
): Promise<{ githubReviewId: string; placeholder: true } | undefined> {
  const [row] = await db
    .select({ placeholderReviewId: run.placeholderReviewId })
    .from(run)
    .where(eq(run.id, runId));
  if (!row?.placeholderReviewId) return undefined;
  return { githubReviewId: row.placeholderReviewId, placeholder: true };
}

export async function closedPlaceholderFor(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
): Promise<{ githubReviewId: string } | undefined> {
  const [row] = await db
    .select({ placeholderReviewId: run.placeholderReviewId })
    .from(run)
    .innerJoin(job, eq(job.id, run.jobId))
    .innerJoin(armedPrTable, eq(armedPrTable.id, job.armedPrId))
    .where(
      and(samePullRequest(armedPr), isNotNull(run.placeholderReviewId), ne(run.status, "running")),
    )
    .orderBy(desc(run.startedAt))
    .limit(1);
  if (!row?.placeholderReviewId) return undefined;
  return { githubReviewId: row.placeholderReviewId };
}

async function closePlaceholder(
  deps: ReviewPostingDeps,
  input: ReviewPostingInput,
  closing: string,
): Promise<void> {
  const placeholder = await placeholderFor(deps.db, input.runId);
  if (!placeholder) return;
  const { armedPr, headSha } = input;
  try {
    await clearReviewing(deps, {
      reference: { owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number },
      headSha,
      token: await deps.github.installationTokenById(armedPr.installationId),
      runId: input.runId,
      livingReviewId: undefined,
      placeholderReviewId: placeholder.githubReviewId,
      closing,
    });
  } catch (error) {
    deps.log?.(
      `reviewing line not cleared for run ${input.runId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
    .select({
      headSha: job.headSha,
      startedAt: run.startedAt,
      result: run.result,
      turns: run.turns,
    })
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
      turns: row.turns,
    };
  });
}

async function newerHeadStarted(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
  jobId: string,
): Promise<boolean> {
  const own = alias(job, "own");
  const [newer] = await db
    .select({ id: job.id })
    .from(job)
    .innerJoin(armedPrTable, eq(armedPrTable.id, job.armedPrId))
    .innerJoin(own, eq(own.id, jobId))
    .leftJoin(run, eq(run.jobId, job.id))
    .leftJoin(reviewPosted, eq(reviewPosted.runId, run.id))
    .where(
      and(
        samePullRequest(armedPr),
        ne(job.headSha, own.headSha),
        sql`(${job.createdAt}, ${job.id}) > (${own.createdAt}, ${own.id})`,
        or(eq(job.state, "done"), isNotNull(reviewPosted.id)),
      ),
    )
    .limit(1);
  return newer !== undefined;
}

export async function postReviewForRun(
  deps: ReviewPostingDeps,
  input: ReviewPostingInput,
): Promise<ReviewPostingOutcome> {
  const { db, github } = deps;
  const log = deps.log ?? (() => {});
  const { armedPr, headSha } = input;
  const reference = { owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number };
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${armedPr.owner}/${armedPr.repo}#${armedPr.number}`}, 0))`,
    );
    await tx
      .delete(reviewPosted)
      .where(
        and(
          sql`${reviewPosted.armedPrId} in (select id from ${armedPrTable} where owner = ${armedPr.owner} and repo = ${armedPr.repo} and number = ${armedPr.number})`,
          isNull(reviewPosted.githubReviewId),
          lt(reviewPosted.postedAt, new Date(Date.now() - STALE_RESERVATION_MS)),
        ),
      );
    const [postedForHead] = await tx
      .select({ id: reviewPosted.id })
      .from(reviewPosted)
      .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
      .where(and(samePullRequest(armedPr), eq(reviewPosted.headSha, headSha)))
      .limit(1);
    if (postedForHead) return "already-posted" as const;
    if (await newerHeadStarted(tx, armedPr, input.jobId)) return "superseded" as const;
    const living = (await livingReviewFor(tx, armedPr)) ?? (await placeholderFor(tx, input.runId));
    if (living) {
      const [inserted] = await tx
        .insert(reviewPosted)
        .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: null })
        .returning({ id: reviewPosted.id });
      if (!inserted) throw new Error("the review reservation was not inserted");
      return { id: inserted.id, living };
    }
    try {
      const token = await github.installationTokenById(armedPr.installationId);
      const render = (commentable: Map<string, Set<number>>) =>
        renderReview({
          result: input.result,
          headSha,
          commentable,
          repositoryUrl: HAWKEYE_REPOSITORY_URL,
          footer: { round: 1, ...(input.turns === undefined ? {} : { turns: input.turns }) },
        });
      const { posted } = await postRenderedReview({
        github,
        reference,
        token,
        review: render(toCommentableMap(input.commentable)),
        renderBodyOnly: () => render(new Map()),
        log,
      });
      await tx
        .insert(reviewPosted)
        .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: posted.id });
      return "posted" as const;
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  });
  if (reservation === "superseded" || reservation === "already-posted") {
    await closePlaceholder(
      deps,
      input,
      reservation === "superseded" ? SUPERSEDED_BODY : ALREADY_POSTED_BODY,
    );
    return reservation;
  }
  if (typeof reservation === "string") return reservation;
  if ("failed" in reservation) return failRun(deps, input.runId, reservation.failed);
  const { living } = reservation;
  const record = (githubReviewId: string) =>
    db.update(reviewPosted).set({ githubReviewId }).where(eq(reviewPosted.id, reservation.id));
  const release = () => db.delete(reviewPosted).where(eq(reviewPosted.id, reservation.id));

  const placeholder = "placeholder" in living;
  const clear = (token: string, closing: string) =>
    clearReviewing(deps, {
      reference,
      headSha,
      token,
      runId: input.runId,
      livingReviewId: placeholder ? undefined : living.githubReviewId,
      placeholderReviewId: placeholder ? living.githubReviewId : null,
      closing,
    });
  let githubWrote = false;
  let token: string | undefined;
  try {
    token = await github.installationTokenById(armedPr.installationId);
    const { previousIds, priorClaims } = placeholder
      ? { previousIds: new Set<string>(), priorClaims: {} }
      : await previousRoundFindings(db, armedPr);
    const rounds = await roundsFor(db, armedPr, input.runId);
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
    if (await newerHeadStarted(db, armedPr, input.jobId)) {
      log(`living body not patched for run ${input.runId}: a newer head is being reviewed`);
      if (githubWrote) return "posted";
      await release();
      if (placeholder) await clear(token, SUPERSEDED_BODY);
      return "superseded";
    }
    await github.updateReview(reference, living.githubReviewId, finalBody, token);
    githubWrote = true;
    if (!supplementalPosted || placeholder) await record(living.githubReviewId);
    return "posted";
  } catch (error) {
    if (!githubWrote) await release();
    if (token !== undefined) await clear(token, NOT_COMPLETED_BODY);
    return failRun(deps, input.runId, error instanceof Error ? error.message : String(error));
  }
}

async function failRun(
  deps: ReviewPostingDeps,
  runId: string,
  message: string,
): Promise<ReviewPostingOutcome> {
  deps.log?.(`review not posted for run ${runId}: ${message}`);
  await deps.db
    .update(run)
    .set({ error: `post: ${message}` })
    .where(eq(run.id, runId));
  return "failed";
}
