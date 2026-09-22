import {
  fetchLinkedIssue,
  fetchPullRequestDetails,
  type LinkedIssue,
  type PullRequestDetails,
} from "./github/client.js";
import type { PullRequestReference } from "./github/pull-request-reference.js";
import type { HarnessSpec } from "./harness/harness.js";
import { commentableLines } from "./review/diff-lines.js";
import { runReviewPipeline, wallClockRanOut } from "./review-pipeline.js";
import type { RunResultStatus } from "./runner/protocol.js";
import type { PriorFinding } from "./contract/prompt.js";
import type { ReviewResult } from "./contract/schema.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

export type RunReviewJobInput = {
  reference: PullRequestReference;
  headSha: string;
  baseSha: string;
  token: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  model?: string;
  contractOverride?: string;
  previousRound?: { headSha: string; findings: PriorFinding[] };
  signal?: AbortSignal;
};
export type RunReviewJobDependencies = {
  fetch: typeof fetch;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
  onTurn?(turns: number): void;
};
export type RunReviewJobOutcome =
  | {
      status: "ok";
      turns: number;
      result: ReviewResult;
      commentable: Record<string, number[]>;
      refusedModel?: string;
    }
  | { status: Exclude<RunResultStatus, "ok">; turns: number; error: string; refusedModel?: string };

export async function runReviewJob(
  input: RunReviewJobInput,
  deps: RunReviewJobDependencies,
): Promise<RunReviewJobOutcome> {
  const { reference } = input;
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(input.wallClockMs);
  let pullRequest: PullRequestDetails;
  let linkedIssue: LinkedIssue | undefined;
  try {
    pullRequest = await fetchPullRequestDetails({ fetch: deps.fetch }, reference, input.token, {
      signal: deadline,
    });
    linkedIssue = await fetchLinkedIssue(
      { fetch: deps.fetch },
      reference,
      pullRequest.body,
      input.token,
      { signal: deadline },
    );
  } catch (error) {
    if (!deadline.aborted) throw error;
    return wallClockRanOut(input.wallClockMs, "fetching the pull request");
  }
  const outcome = await runReviewPipeline(
    {
      cloneUrl: pullRequest.cloneUrl,
      token: input.token,
      runDirectory: input.runDirectory,
      maxTurns: input.maxTurns,
      wallClockMs: input.wallClockMs,
      startedAt,
      deadline,
      ...(input.model === undefined ? {} : { model: input.model }),
      depth: pullRequest.commits + 1,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.previousRound === undefined ? {} : { previousRound: input.previousRound }),
      prompt: {
        repository: { owner: reference.owner, repo: reference.repo },
        pullRequest: {
          number: reference.number,
          title: pullRequest.title,
          body: pullRequest.body,
          author: pullRequest.author,
          baseSha: input.baseSha,
          headSha: input.headSha,
        },
        ...(linkedIssue ? { linkedIssue } : {}),
        ...(input.contractOverride === undefined
          ? {}
          : { contractOverride: input.contractOverride }),
      },
    },
    deps,
  );
  const fallback = outcome.refusedModel === undefined ? {} : { refusedModel: outcome.refusedModel };
  return outcome.status === "ok"
    ? {
        status: "ok",
        turns: outcome.turns,
        result: outcome.result,
        commentable: toCommentableRecord(commentableLines(outcome.diff)),
        ...fallback,
      }
    : { status: outcome.status, turns: outcome.turns, error: outcome.error, ...fallback };
}

function toCommentableRecord(lines: Map<string, Set<number>>): Record<string, number[]> {
  return Object.fromEntries(
    [...lines].map(([path, set]) => [path, [...set].sort((a, b) => a - b)]),
  );
}
