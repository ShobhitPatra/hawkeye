import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewResult } from "./contract/schema.js";
import type { GitHubClient } from "./github/client.js";
import type { PullRequestReference } from "./github/pull-request-reference.js";
import type { HarnessSpec } from "./harness/harness.js";
import { commentableLines } from "./review/diff-lines.js";
import { alreadyReviewed } from "./review/idempotency.js";
import { postRenderedReview } from "./review/post.js";
import { renderReview, type RenderedReview } from "./review/render.js";
import { runReviewPipeline } from "./review-pipeline.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

export type RunReviewInput = {
  reference: PullRequestReference;
  botLogin: string;
  repositoryUrl: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  dryRun: boolean;
  force: boolean;
  contractOverride?: string;
};
export type RunReviewDependencies = {
  github: GitHubClient;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
};
export type RunReviewOutcome =
  | { kind: "posted"; url: string; headSha: string; findings: number }
  | {
      kind: "dry-run";
      review: RenderedReview;
      result: ReviewResult;
      turns: number;
      reviewPath: string;
      headSha: string;
    }
  | { kind: "already-reviewed"; headSha: string };

export async function runReview(
  input: RunReviewInput,
  deps: RunReviewDependencies,
): Promise<RunReviewOutcome> {
  const { reference, runDirectory } = input;
  const token = await deps.github.installationToken(reference);
  const pullRequest = await deps.github.pullRequest(reference, token);

  if (
    !input.force &&
    alreadyReviewed(
      await deps.github.reviews(reference, token),
      pullRequest.headSha,
      input.botLogin,
    )
  ) {
    return { kind: "already-reviewed", headSha: pullRequest.headSha };
  }

  const mergeBase = await deps.github.mergeBase(
    reference,
    pullRequest.baseSha,
    pullRequest.headSha,
    token,
  );
  deps.log(
    `PR #${pullRequest.number} "${pullRequest.title}" head ${pullRequest.headSha.slice(0, 7)} merge base ${mergeBase.slice(0, 7)}`,
  );

  const linkedIssue = await deps.github.linkedIssue(reference, pullRequest.body, token);
  const outcome = await runReviewPipeline(
    {
      cloneUrl: pullRequest.cloneUrl,
      token,
      depth: pullRequest.commits + 1,
      runDirectory,
      maxTurns: input.maxTurns,
      wallClockMs: input.wallClockMs,
      prompt: {
        repository: { owner: reference.owner, repo: reference.repo },
        pullRequest: {
          number: pullRequest.number,
          title: pullRequest.title,
          body: pullRequest.body,
          author: pullRequest.author,
          baseSha: mergeBase,
          headSha: pullRequest.headSha,
        },
        ...(linkedIssue ? { linkedIssue } : {}),
        ...(input.contractOverride === undefined
          ? {}
          : { contractOverride: input.contractOverride }),
      },
    },
    deps,
  );
  if (outcome.status === "invalid-output") throw new Error(outcome.error);
  if (outcome.status !== "ok")
    throw new Error(`Harness ${outcome.status}: ${outcome.error} after ${outcome.turns} turns`);
  const { result, diff } = outcome;
  const render = (commentable: Map<string, Set<number>>) =>
    renderReview({
      result,
      headSha: pullRequest.headSha,
      commentable,
      repositoryUrl: input.repositoryUrl,
    });
  const reviewPath = join(runDirectory, "review.json");
  const review = render(commentableLines(diff));
  await writeFile(reviewPath, JSON.stringify(review, null, 2));

  if (input.dryRun)
    return {
      kind: "dry-run",
      review,
      result,
      turns: outcome.turns,
      reviewPath,
      headSha: pullRequest.headSha,
    };
  const { review: sent, posted } = await postRenderedReview({
    github: deps.github,
    reference,
    token,
    review,
    renderBodyOnly: () => render(new Map()),
    log: deps.log,
  });
  if (sent !== review) await writeFile(reviewPath, JSON.stringify(sent, null, 2));
  return {
    kind: "posted",
    url: posted.url,
    headSha: pullRequest.headSha,
    findings: result.findings.length,
  };
}
