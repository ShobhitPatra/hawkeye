import {
  type GitHubClient,
  HAWKEYE_REPOSITORY_URL,
  postRenderedReview,
  renderReview,
  type ReviewResult,
} from "@hawkeye/core";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr as armedPrTable, reviewPosted, run } from "./db/schema";

export type ReviewPostingDeps = { db: Db; github: GitHubClient; log?: (line: string) => void };
export type ReviewPostingInput = {
  runId: string;
  armedPr: { id: string; installationId: string; owner: string; repo: string; number: number };
  headSha: string;
  result: ReviewResult;
  commentable: Record<string, number[]>;
};
export type ReviewPostingOutcome = "posted" | "already-posted" | "failed";

function toCommentableMap(commentable: Record<string, number[]>): Map<string, Set<number>> {
  return new Map(Object.entries(commentable).map(([path, lines]) => [path, new Set(lines)]));
}

export async function postReviewForRun(
  deps: ReviewPostingDeps,
  input: ReviewPostingInput,
): Promise<ReviewPostingOutcome> {
  const { db, github } = deps;
  const log = deps.log ?? (() => {});
  const { armedPr, headSha } = input;
  const [existing] = await db
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
  if (existing) return "already-posted";

  const render = (commentable: Map<string, Set<number>>) =>
    renderReview({
      result: input.result,
      headSha,
      commentable,
      repositoryUrl: HAWKEYE_REPOSITORY_URL,
    });
  try {
    const token = await github.installationTokenById(armedPr.installationId);
    const { posted } = await postRenderedReview({
      github,
      reference: { owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number },
      token,
      review: render(toCommentableMap(input.commentable)),
      renderBodyOnly: () => render(new Map()),
      log,
    });
    const inserted = await db
      .insert(reviewPosted)
      .values({ runId: input.runId, armedPrId: armedPr.id, headSha, githubReviewId: posted.id })
      .onConflictDoNothing({ target: [reviewPosted.armedPrId, reviewPosted.headSha] })
      .returning({ id: reviewPosted.id });
    return inserted.length === 0 ? "already-posted" : "posted";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`review not posted for run ${input.runId}: ${message}`);
    await db
      .update(run)
      .set({ error: `post: ${message}` })
      .where(eq(run.id, input.runId));
    return "failed";
  }
}
