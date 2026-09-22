import {
  decodeMarker,
  encodeMarker,
  findingId,
  type GitHubClient,
  GitHubRequestError,
  HAWKEYE_REPOSITORY_URL,
  type RoundSummary,
  postRenderedReview,
  renderLivingReview,
  renderMinimalLivingReview,
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

type Living = { githubReviewId: string; kind: "living" | "adopted" | "placeholder" };

async function livingReviewOnGitHub(
  github: Pick<GitHubClient, "botLogin" | "reviews">,
  reference: { owner: string; repo: string; number: number },
  token: string,
): Promise<{ githubReviewId: string; headSha: string } | undefined> {
  const [login, reviews] = await Promise.all([github.botLogin(), github.reviews(reference, token)]);
  for (const review of reviews) {
    if (review.authorLogin !== login || review.id === undefined) continue;
    const headSha = decodeMarker(review.body);
    if (headSha === undefined || !/^### /m.test(review.body)) continue;
    return { githubReviewId: review.id, headSha };
  }
  return undefined;
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
      livingReviewId: (await livingReviewFor(deps.db, armedPr))?.githubReviewId,
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

async function postedForHead(
  db: Db,
  armedPr: ReviewPostingInput["armedPr"],
  headSha: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewPosted.id })
    .from(reviewPosted)
    .innerJoin(armedPrTable, eq(armedPrTable.id, reviewPosted.armedPrId))
    .where(and(samePullRequest(armedPr), eq(reviewPosted.headSha, headSha)))
    .limit(1);
  return row !== undefined;
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
  let onGitHub: Awaited<ReturnType<typeof livingReviewOnGitHub>>;
  let firstPostToken: string | undefined;
  if (
    !(await livingReviewFor(db, armedPr)) &&
    !(await postedForHead(db, armedPr, headSha)) &&
    !(await newerHeadStarted(db, armedPr, input.jobId))
  ) {
    try {
      firstPostToken = await github.installationTokenById(armedPr.installationId);
      onGitHub = await livingReviewOnGitHub(github, reference, firstPostToken);
    } catch (error) {
      return failRun(deps, input.runId, error instanceof Error ? error.message : String(error));
    }
  }
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
    if (await postedForHead(tx, armedPr, headSha)) return "already-posted" as const;
    if (await newerHeadStarted(tx, armedPr, input.jobId)) return "superseded" as const;
    const known = await livingReviewFor(tx, armedPr);
    let living: Living | undefined = known ? { ...known, kind: "living" } : undefined;
    if (!living && onGitHub?.headSha === headSha) {
      log(`adopted review ${onGitHub.githubReviewId} already on GitHub for run ${input.runId}`);
      await tx.insert(reviewPosted).values({
        runId: input.runId,
        armedPrId: armedPr.id,
        headSha,
        githubReviewId: onGitHub.githubReviewId,
      });
      return "adopted" as const;
    }
    if (!living && onGitHub) {
      log(`adopted review ${onGitHub.githubReviewId} as the living review for run ${input.runId}`);
      living = { githubReviewId: onGitHub.githubReviewId, kind: "adopted" };
    }
    if (!living) {
      const own = await placeholderFor(tx, input.runId);
      if (own) living = { githubReviewId: own.githubReviewId, kind: "placeholder" };
    }
    if (living) {
      const [inserted] = await tx
        .insert(reviewPosted)
        .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: null })
        .returning({ id: reviewPosted.id });
      if (!inserted) throw new Error("the review reservation was not inserted");
      return { id: inserted.id, living };
    }
    try {
      const token = firstPostToken ?? (await github.installationTokenById(armedPr.installationId));
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
  if (reservation === "adopted") {
    await closePlaceholder(deps, input, ALREADY_POSTED_BODY);
    return "posted";
  }
  if (typeof reservation === "string") return reservation;
  if ("failed" in reservation) return failRun(deps, input.runId, reservation.failed);
  const { living } = reservation;
  const record = (githubReviewId: string) =>
    db.update(reviewPosted).set({ githubReviewId }).where(eq(reviewPosted.id, reservation.id));
  const release = () => db.delete(reviewPosted).where(eq(reviewPosted.id, reservation.id));

  const ownPlaceholderId = async () =>
    living.kind === "placeholder"
      ? living.githubReviewId
      : ((await placeholderFor(db, input.runId))?.githubReviewId ?? null);
  const clear = async (token: string, closing: string) =>
    clearReviewing(deps, {
      reference,
      headSha,
      token,
      runId: input.runId,
      livingReviewId:
        living.kind === "placeholder"
          ? (await livingReviewFor(db, armedPr))?.githubReviewId
          : living.githubReviewId,
      placeholderReviewId: await ownPlaceholderId(),
      closing,
    });
  let githubWrote = false;
  let token: string | undefined;
  try {
    token = await github.installationTokenById(armedPr.installationId);
    const { previousIds, priorClaims } =
      living.kind === "living"
        ? await previousRoundFindings(db, armedPr)
        : { previousIds: new Set<string>(), priorClaims: {} };
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
    if (inline.trimmed.length > 0)
      log(`living body over budget for run ${input.runId}; left out ${inline.trimmed.join(", ")}`);
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
      if (living.kind !== "living") await clear(token, SUPERSEDED_BODY);
      return "superseded";
    }
    try {
      await github.updateReview(reference, living.githubReviewId, finalBody, token);
    } catch (error) {
      if (!(error instanceof GitHubRequestError && error.status === 422)) throw error;
      log(`living body refused for run ${input.runId} (${error.message}); posting the short form`);
      await github.updateReview(
        reference,
        living.githubReviewId,
        renderMinimalLivingReview({
          result: input.result,
          headSha,
          repositoryUrl: HAWKEYE_REPOSITORY_URL,
          rounds,
        }),
        token,
      );
      await db
        .update(run)
        .set({
          error: `post: GitHub refused the full review (${error.message}); the short form was posted`,
        })
        .where(eq(run.id, input.runId));
    }
    githubWrote = true;
    if (!supplementalPosted || living.kind !== "living") await record(living.githubReviewId);
    if (living.kind === "adopted") await closePlaceholder(deps, input, ALREADY_POSTED_BODY);
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
