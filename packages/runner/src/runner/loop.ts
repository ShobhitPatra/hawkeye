import {
  type ClaimedJob,
  createWorktree,
  type HarnessSpec,
  readRepositoryRules,
  type RunResultReport,
  runReviewJob,
} from "@hawkeye/core";
import { ControlPlaneRequestError, type ControlPlaneClient } from "./client.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_RETRY_DELAY_MS = 5_000;
export const DEFAULT_EMPTY_POLL_DELAY_MS = 1_000;
export const DEFAULT_RESULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];
export const ONCE_CLAIM_ATTEMPTS = 3;

export type RunnerLoopDependencies = {
  client: ControlPlaneClient;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  createRunDirectory(reference: ClaimedJob["pullRequest"]): Promise<string>;
  fetch: typeof fetch;
  log(line: string): void;
  contractOverride?: string;
  signal?: AbortSignal;
  heartbeatIntervalMs?: number;
  retryDelayMs?: number;
  emptyPollDelayMs?: number;
  resultRetryDelaysMs?: number[];
  sleep?(milliseconds: number, signal?: AbortSignal): Promise<void>;
};

function sleepFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function reportFor(
  claimed: ClaimedJob,
  deps: RunnerLoopDependencies,
): Promise<RunResultReport> {
  const { job, pullRequest } = claimed;
  const runDirectory = await deps.createRunDirectory(pullRequest);
  deps.log(`run directory: ${runDirectory}`);
  const contractOverride = deps.contractOverride ?? claimed.settings.promptOverride;
  const outcome = await runReviewJob(
    {
      reference: pullRequest,
      headSha: job.headSha,
      baseSha: job.baseSha,
      token: claimed.installationToken,
      runDirectory,
      maxTurns: claimed.settings.maxTurns,
      wallClockMs: claimed.settings.wallClockMinutes * 60_000,
      ...(contractOverride === undefined ? {} : { contractOverride }),
    },
    {
      fetch: deps.fetch,
      harness: deps.harness,
      createWorktree: deps.createWorktree,
      readRepositoryRules: deps.readRepositoryRules,
      log: deps.log,
      onTurn: () => {
        deps.client
          .sendEvents(job.runId, [{ type: "turn", at: new Date().toISOString() }])
          .catch((error: Error) => deps.log(`turn event not sent: ${error.message}`));
      },
    },
  );
  return outcome.status === "ok"
    ? {
        status: "ok",
        turns: outcome.turns,
        result: outcome.result,
        commentable: outcome.commentable,
      }
    : { status: outcome.status, turns: outcome.turns, error: outcome.error };
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof ControlPlaneRequestError) || error.status >= 500;
}

async function deliverResult(
  runId: string,
  report: RunResultReport,
  deps: RunnerLoopDependencies,
): Promise<"delivered" | "dropped" | "undelivered"> {
  const sleep = deps.sleep ?? sleepFor;
  const delays = deps.resultRetryDelaysMs ?? DEFAULT_RESULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const acknowledged = await deps.client.sendResult(runId, report);
      deps.log(`result ${report.status} after ${report.turns} turn(s)`);
      if (acknowledged.posted !== undefined) deps.log(`review ${acknowledged.posted}`);
      return "delivered";
    } catch (error) {
      if (error instanceof ControlPlaneRequestError && error.status === 409) {
        deps.log(`result ${report.status} dropped: the claim was lost`);
        return "dropped";
      }
      const message = (error as Error).message;
      const delay = delays[attempt];
      if (!isRetryable(error) || delay === undefined) {
        deps.log(`result ${report.status} not delivered: ${message}`);
        return "undelivered";
      }
      deps.log(`result not sent (${message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

export async function runJob(
  claimed: ClaimedJob,
  deps: RunnerLoopDependencies,
): Promise<"delivered" | "dropped" | "undelivered"> {
  const { job, pullRequest } = claimed;
  deps.log(
    `job claimed: ${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number} head ${job.headSha.slice(0, 7)}`,
  );
  const heartbeat = setInterval(() => {
    deps.client
      .heartbeat(job.id)
      .catch((error: Error) => deps.log(`heartbeat failed: ${error.message}`));
  }, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  let report: RunResultReport;
  try {
    report = await reportFor(claimed, deps);
  } catch (error) {
    report = { status: "error", turns: 0, error: (error as Error).message };
  } finally {
    clearInterval(heartbeat);
  }
  return deliverResult(job.runId, report, deps);
}

export async function runRunnerLoop(
  deps: RunnerLoopDependencies,
  options: { once?: boolean } = {},
): Promise<void> {
  const sleep = deps.sleep ?? sleepFor;
  let failedClaims = 0;
  while (!deps.signal?.aborted) {
    let claimed: ClaimedJob | undefined;
    try {
      claimed = await deps.client.claimJob(deps.signal ? { signal: deps.signal } : {});
    } catch (error) {
      if (isAbort(error) && deps.signal?.aborted) return;
      if (error instanceof ControlPlaneRequestError && error.status === 401) throw error;
      failedClaims += 1;
      if (options.once && failedClaims >= ONCE_CLAIM_ATTEMPTS)
        throw new Error(`claim failed ${failedClaims} times: ${(error as Error).message}`, {
          cause: error,
        });
      deps.log(`claim failed: ${(error as Error).message}`);
      await sleep(deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, deps.signal);
      continue;
    }
    failedClaims = 0;
    if (claimed === undefined) {
      if (options.once) {
        deps.log("no job queued");
        return;
      }
      await sleep(deps.emptyPollDelayMs ?? DEFAULT_EMPTY_POLL_DELAY_MS, deps.signal);
      continue;
    }
    const delivery = await runJob(claimed, deps);
    if (options.once) {
      if (delivery === "undelivered") throw new Error("the result was not delivered");
      return;
    }
  }
}
