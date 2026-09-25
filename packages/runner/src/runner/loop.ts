import {
  type ClaimedJob,
  createWorktree,
  type HarnessSpec,
  type PlanLimit,
  planLimitIn,
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
export const DEFAULT_CONCURRENCY = 1;
export const PLAN_LIMIT_PAUSE_MS = 60_000;
export const PLAN_LIMIT_PAUSE_CAP_MS = 16 * 60_000;
export const CLOCK_CHECK_INTERVAL_MS = 15_000;
export const SLEEP_GAP_MS = 60_000;

export type JobOutcome = {
  delivery: "delivered" | "dropped" | "undelivered";
  startedAt: number;
  succeeded: boolean;
  planLimit?: PlanLimit;
};

export type RunnerEvent = { slot?: number } & (
  | { state: "claimed"; subject: string; headSha: string }
  | { state: "reviewing"; runDirectory: string }
  | { state: "posted"; result: ReviewResult; turns: number; durationMs: number }
  | {
      state: "skipped" | "failed" | "waiting" | "delivered" | "idle" | "superseded";
      detail: string;
    }
);

export type RunnerLoopDependencies = {
  client: ControlPlaneClient;
  harness: HarnessSpec;
  harnesses?: Record<string, HarnessSpec>;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  createRunDirectory(reference: ClaimedJob["pullRequest"]): Promise<string>;
  fetch: typeof fetch;
  report(event: RunnerEvent): void;
  log(line: string, runDirectory: string): void;
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

export function sleptFor(lastTick: number, now: number, intervalMs: number): number | undefined {
  return now - lastTick - intervalMs > SLEEP_GAP_MS ? now - lastTick : undefined;
}

export function watchClock(
  report: RunnerLoopDependencies["report"],
  intervalMs = CLOCK_CHECK_INTERVAL_MS,
): () => void {
  let lastTick = Date.now();
  const clock = setInterval(() => {
    const now = Date.now();
    const slept = sleptFor(lastTick, now, intervalMs);
    lastTick = now;
    if (slept !== undefined)
      report({
        state: "waiting",
        detail: `the machine was asleep for ${Math.round(slept / 60_000)} min`,
      });
  }, intervalMs);
  clock.unref();
  return () => clearInterval(clock);
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

function harnessFor(
  name: string | undefined,
  deps: RunnerLoopDependencies,
): HarnessSpec | undefined {
  if (name === undefined || name === deps.harness.name) return deps.harness;
  return deps.harnesses?.[name];
}

async function reportFor(
  claimed: ClaimedJob,
  deps: RunnerLoopDependencies,
  runDirectory: string,
  signal: AbortSignal,
  inFlight: Set<Promise<void>>,
): Promise<RunResultReport> {
  const { job, pullRequest } = claimed;
  const contractOverride = deps.contractOverride ?? claimed.settings.promptOverride;
  const harness = harnessFor(claimed.settings.harness, deps);
  if (harness === undefined)
    return {
      status: "error",
      turns: 0,
      error: `Harness ${claimed.settings.harness} is not available on this runner; choose another in Settings.`,
    };
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
      harness,
      createWorktree: deps.createWorktree,
      readRepositoryRules: deps.readRepositoryRules,
      log: (line) => deps.log(line, runDirectory),
      onTurn: () => {
        const sent = deps.client
          .sendEvents(job.runId, [{ type: "turn", at: new Date().toISOString() }])
          .catch((error: Error) =>
            deps.report({ state: "waiting", detail: `turn event not sent: ${error.message}` }),
          )
          .finally(() => inFlight.delete(sent));
        inFlight.add(sent);
      },
    },
  );
  const fallback = outcome.refusedModel === undefined ? {} : { refusedModel: outcome.refusedModel };
  return outcome.status === "ok"
    ? {
        status: "ok",
        turns: outcome.turns,
        result: outcome.result,
        commentable: outcome.commentable,
        ...fallback,
      }
    : { status: outcome.status, turns: outcome.turns, error: outcome.error, ...fallback };
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
  loopDeps: RunnerLoopDependencies,
  options: { slot?: number; superseded?: AbortSignal } = {},
): Promise<JobOutcome> {
  const { slot } = options;
  const deps: RunnerLoopDependencies =
    slot === undefined
      ? loopDeps
      : { ...loopDeps, report: (event) => loopDeps.report({ ...event, slot }) };
  const { job, pullRequest } = claimed;
  const startedAt = Date.now();
  deps.report({
    state: "claimed",
    subject: `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`,
    headSha: job.headSha,
  });
  const control = new AbortController();
  const supersede = () => {
    if (control.signal.aborted) return;
    deps.report({ state: "superseded", detail: "a newer push is waiting; stopping this review" });
    control.abort();
  };
  options.superseded?.addEventListener("abort", supersede, { once: true });
  const heartbeat = setInterval(() => {
    deps.client
      .heartbeat(job.id)
      .then(({ superseded }) => {
        if (superseded) supersede();
      })
      .catch((error: Error) =>
        deps.report({ state: "waiting", detail: `heartbeat failed: ${error.message}` }),
      );
  }, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  let report: RunResultReport;
  let runDirectory: string | undefined;
  const inFlight = new Set<Promise<void>>();
  try {
    runDirectory = await deps.createRunDirectory(pullRequest);
    deps.report({ state: "reviewing", runDirectory });
    report = await reportFor(claimed, deps, runDirectory, control.signal, inFlight);
  } catch (error) {
    report = { status: "error", turns: 0, error: (error as Error).message };
  } finally {
    clearInterval(heartbeat);
    options.superseded?.removeEventListener("abort", supersede);
  }
  await Promise.all(inFlight);
  const durationMs = Date.now() - startedAt;
  if (report.status !== "ok" && report.status !== "superseded")
    deps.report({
      state: "failed",
      detail: `${report.error ?? report.status} after ${turnsOf(report.turns)}${keptIn(runDirectory)}`,
    });
  const delivery = await deliverResult(
    job.runId,
    report,
    { headSha: job.headSha, durationMs, runDirectory },
    deps,
  );
  const planLimit = report.status === "error" ? planLimitIn(report.error ?? "") : undefined;
  return {
    delivery,
    startedAt,
    succeeded: report.status === "ok",
    ...(planLimit === undefined ? {} : { planLimit }),
  };
}

export async function runRunnerLoop(
  deps: RunnerLoopDependencies,
  options: { once?: boolean } = {},
): Promise<void> {
  const sleep = deps.sleep ?? sleepFor;
  let failedClaims = 0;
  let concurrency = DEFAULT_CONCURRENCY;
  let lastWaitMs: number | undefined;
  let limitedRuns = 0;
  let pausedAt = 0;
  let pausedUntil = 0;
  const settle = (outcome: JobOutcome) => {
    if (outcome.planLimit === undefined) {
      if (outcome.succeeded) limitedRuns = 0;
      return;
    }
    if (outcome.startedAt < pausedAt) return;
    limitedRuns += 1;
    pausedAt = Date.now();
    const pauseMs = Math.min(PLAN_LIMIT_PAUSE_MS * 2 ** (limitedRuns - 1), PLAN_LIMIT_PAUSE_CAP_MS);
    pausedUntil = Date.now() + pauseMs;
    deps.report({
      state: "waiting",
      detail: `${outcome.planLimit === "rate limit" ? "the plan rate-limited the run" : "the plan is overloaded"}; claiming again in ${pauseMs / 60_000} min`,
    });
  };
  const running = new Map<number, { subject: string; finished: Promise<unknown>; stop(): void }>();
  const freeSlot = () => {
    for (let slot = 1; ; slot += 1) if (!running.has(slot)) return slot;
  };
  while (!deps.signal?.aborted) {
    if (running.size >= concurrency) {
      await Promise.race([...running.values()].map((job) => job.finished));
      continue;
    }
    const pauseLeftMs = pausedUntil - Date.now();
    if (pauseLeftMs > 0) {
      const pausedFor = pausedUntil;
      await sleep(pauseLeftMs, deps.signal);
      if (pausedUntil === pausedFor) pausedUntil = 0;
      continue;
    }
    let claimed: ClaimedJob | undefined;
    let waitMs = deps.emptyPollDelayMs ?? DEFAULT_EMPTY_POLL_DELAY_MS;
    try {
      const answer = await deps.client.claimJob(deps.signal ? { signal: deps.signal } : {});
      if (answer !== undefined && "retryAfterMs" in answer) waitMs = answer.retryAfterMs;
      else claimed = answer;
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
      if (waitMs !== lastWaitMs && waitMs > (deps.emptyPollDelayMs ?? DEFAULT_EMPTY_POLL_DELAY_MS))
        deps.report({
          state: "idle",
          detail: `no pull request has reviews on; asking again every ${waitMs / 1000}s`,
        });
      lastWaitMs = waitMs;
      await sleep(waitMs, deps.signal);
      continue;
    }
    if (options.once) {
      const { delivery } = await runJob(claimed, deps);
      if (delivery === "undelivered") throw new Error("the result was not delivered");
      return;
    }
    lastWaitMs = undefined;
    concurrency = claimed.settings.concurrency ?? DEFAULT_CONCURRENCY;
    const { owner, repo, number } = claimed.pullRequest;
    const subject = `${owner}/${repo}#${number}`;
    for (const older of running.values()) if (older.subject === subject) older.stop();
    const slot = freeSlot();
    const superseded = new AbortController();
    const finished = runJob(claimed, deps, {
      ...(concurrency > 1 ? { slot } : {}),
      superseded: superseded.signal,
    })
      .then(settle)
      .finally(() => running.delete(slot));
    running.set(slot, { subject, finished, stop: () => superseded.abort() });
  }
  await Promise.all([...running.values()].map((job) => job.finished));
}
