import { fetchPullRequestDetails } from "./github/client.js";
import type { PullRequestReference } from "./github/pull-request-reference.js";
import type { HarnessSpec } from "./harness/harness.js";
import { runReviewPipeline } from "./review-pipeline.js";
import type { RunResultStatus } from "./runner/protocol.js";
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
  contractOverride?: string;
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
  | { status: "ok"; turns: number; result: ReviewResult }
  | { status: Exclude<RunResultStatus, "ok">; turns: number; error: string };

export async function runReviewJob(
  input: RunReviewJobInput,
  deps: RunReviewJobDependencies,
): Promise<RunReviewJobOutcome> {
  const { reference } = input;
  const pullRequest = await fetchPullRequestDetails({ fetch: deps.fetch }, reference, input.token);
  const outcome = await runReviewPipeline(
    {
      cloneUrl: pullRequest.cloneUrl,
      token: input.token,
      runDirectory: input.runDirectory,
      maxTurns: input.maxTurns,
      wallClockMs: input.wallClockMs,
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
        ...(input.contractOverride === undefined
          ? {}
          : { contractOverride: input.contractOverride }),
      },
    },
    deps,
  );
  return outcome.status === "ok"
    ? { status: "ok", turns: outcome.turns, result: outcome.result }
    : { status: outcome.status, turns: outcome.turns, error: outcome.error };
}
