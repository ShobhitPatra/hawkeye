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
  sleep?(milliseconds: number, signal?: AbortSignal): Promise<void>;
};

function sleepFor(milliseconds: number, signal?: AbortSignal): Promise<void> {
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
    ? { status: "ok", turns: outcome.turns, result: outcome.result }
    : { status: outcome.status, turns: outcome.turns, error: outcome.error };
}

export async function runJob(claimed: ClaimedJob, deps: RunnerLoopDependencies): Promise<void> {
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
  try {
    await deps.client.sendResult(job.runId, report);
    deps.log(`result ${report.status} after ${report.turns} turn(s)`);
  } catch (error) {
    if (error instanceof ControlPlaneRequestError && error.status === 409) {
      deps.log(`result ${report.status} dropped: the claim was lost`);
      return;
    }
    throw error;
  }
}

export async function runRunnerLoop(
  deps: RunnerLoopDependencies,
  options: { once?: boolean } = {},
): Promise<void> {
  const sleep = deps.sleep ?? sleepFor;
  while (!deps.signal?.aborted) {
    let claimed: ClaimedJob | undefined;
    try {
      claimed = await deps.client.claimJob(deps.signal ? { signal: deps.signal } : {});
    } catch (error) {
      if (isAbort(error) && deps.signal?.aborted) return;
      if (error instanceof ControlPlaneRequestError && error.status === 401) throw error;
      deps.log(`claim failed: ${(error as Error).message}`);
      await sleep(deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, deps.signal);
      continue;
    }
    if (claimed === undefined) {
      if (!options.once) continue;
      deps.log("no job queued");
      return;
    }
    await runJob(claimed, deps);
    if (options.once) return;
  }
}
