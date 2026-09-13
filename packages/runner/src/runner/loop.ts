import {
  type ClaimedJob,
  createWorktree,
  type HarnessSpec,
  readRepositoryRules,
  type ReviewResult,
  type RunResultReport,
  runReviewJob,
} from "@hawkeye/core";
import { ControlPlaneRequestError, type ControlPlaneClient } from "./client.js";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_RETRY_DELAY_MS = 5_000;
export const DEFAULT_EMPTY_POLL_DELAY_MS = 1_000;
export const DEFAULT_RESULT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];
export const ONCE_CLAIM_ATTEMPTS = 3;

export type RunnerEvent =
  | { state: "claimed"; subject: string; headSha: string }
  | { state: "reviewing"; runDirectory: string }
  | { state: "posted"; result: ReviewResult; turns: number; durationMs: number }
  | {
      state: "skipped" | "failed" | "waiting" | "delivered" | "idle" | "superseded";
      detail: string;
    };

export type RunnerLoopDependencies = {
  client: ControlPlaneClient;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  createRunDirectory(reference: ClaimedJob["pullRequest"]): Promise<string>;
  fetch: typeof fetch;
  report(event: RunnerEvent): void;
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

function turnsOf(turns: number): string {
  return `${turns} turn${turns === 1 ? "" : "s"}`;
}

function keptIn(runDirectory: string | undefined): string {
  return runDirectory === undefined ? "" : ` · run kept in ${runDirectory}`;
}

async function reportFor(
  claimed: ClaimedJob,
  deps: RunnerLoopDependencies,
  runDirectory: string,
  signal: AbortSignal,
): Promise<RunResultReport> {
  const { job, pullRequest } = claimed;
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
      ...(claimed.settings.model === undefined ? {} : { model: claimed.settings.model }),
      ...(contractOverride === undefined ? {} : { contractOverride }),
      ...(claimed.previousRound === undefined ? {} : { previousRound: claimed.previousRound }),
      signal,
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
          .catch((error: Error) =>
            deps.report({ state: "waiting", detail: `turn event not sent: ${error.message}` }),
          );
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

function reportAcknowledged(
  report: RunResultReport,
  posted: string | undefined,
  context: { headSha: string; durationMs: number },
  deps: RunnerLoopDependencies,
): void {
  if (report.status === "superseded") {
    deps.report({ state: "delivered", detail: "the newer push's review follows" });
    return;
  }
  if (report.status !== "ok" || report.result === undefined) {
    deps.report({ state: "delivered", detail: "the control plane recorded the failure" });
    return;
  }
  switch (posted) {
    case "posted":
      deps.report({
        state: "posted",
        result: report.result,
        turns: report.turns,
        durationMs: context.durationMs,
      });
      return;
    case "already-posted":
      deps.report({
        state: "skipped",
        detail: `already posted for ${context.headSha.slice(0, 7)}`,
      });
      return;
    case "superseded":
      deps.report({ state: "skipped", detail: "superseded by a newer push" });
      return;
    case "failed":
      deps.report({ state: "failed", detail: "the control plane could not post the review" });
      return;
    default:
      deps.report({ state: "delivered", detail: "the control plane recorded the result" });
  }
}

async function deliverResult(
  runId: string,
  report: RunResultReport,
  context: { headSha: string; durationMs: number; runDirectory: string | undefined },
  deps: RunnerLoopDependencies,
): Promise<"delivered" | "dropped" | "undelivered"> {
  const sleep = deps.sleep ?? sleepFor;
  const delays = deps.resultRetryDelaysMs ?? DEFAULT_RESULT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const acknowledged = await deps.client.sendResult(runId, report);
      reportAcknowledged(report, acknowledged.posted, context, deps);
      return "delivered";
    } catch (error) {
      if (error instanceof ControlPlaneRequestError && error.status === 409) {
        deps.report({ state: "failed", detail: "result dropped: the claim was lost" });
        return "dropped";
      }
      const message = (error as Error).message;
      const delay = delays[attempt];
      if (!isRetryable(error) || delay === undefined) {
        deps.report({
          state: "failed",
          detail: `result not delivered: ${message}${keptIn(context.runDirectory)}`,
        });
        return "undelivered";
      }
      deps.report({
        state: "waiting",
        detail: `result not sent (${message}); retrying in ${delay / 1000}s`,
      });
      await sleep(delay);
    }
  }
}

export async function runJob(
  claimed: ClaimedJob,
  deps: RunnerLoopDependencies,
): Promise<"delivered" | "dropped" | "undelivered"> {
  const { job, pullRequest } = claimed;
  const startedAt = Date.now();
  deps.report({
    state: "claimed",
    subject: `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`,
    headSha: job.headSha,
  });
  const control = new AbortController();
  const heartbeat = setInterval(() => {
    deps.client
      .heartbeat(job.id)
      .then(({ superseded }) => {
        if (!superseded || control.signal.aborted) return;
        deps.report({
          state: "superseded",
          detail: "a newer push is waiting; stopping this review",
        });
        control.abort();
      })
      .catch((error: Error) =>
        deps.report({ state: "waiting", detail: `heartbeat failed: ${error.message}` }),
      );
  }, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  let report: RunResultReport;
  let runDirectory: string | undefined;
  try {
    runDirectory = await deps.createRunDirectory(pullRequest);
    deps.report({ state: "reviewing", runDirectory });
    report = await reportFor(claimed, deps, runDirectory, control.signal);
  } catch (error) {
    report = { status: "error", turns: 0, error: (error as Error).message };
  } finally {
    clearInterval(heartbeat);
  }
  const durationMs = Date.now() - startedAt;
  if (report.status !== "ok" && report.status !== "superseded")
    deps.report({
      state: "failed",
      detail: `${report.error ?? report.status} after ${turnsOf(report.turns)}${keptIn(runDirectory)}`,
    });
  return deliverResult(job.runId, report, { headSha: job.headSha, durationMs, runDirectory }, deps);
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
      const delay = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
      deps.report({
        state: "waiting",
        detail: `claim failed: ${(error as Error).message}; retrying in ${delay / 1000}s`,
      });
      await sleep(delay, deps.signal);
      continue;
    }
    failedClaims = 0;
    if (claimed === undefined) {
      if (options.once) {
        deps.report({ state: "idle", detail: "no job queued" });
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
