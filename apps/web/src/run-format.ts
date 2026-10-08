import { type PlanLimit, planLimitIn, type Verdict } from "@hawkeye/core";
import type { PullRequestRun } from "./runs";

const MAX_ERROR_LENGTH = 120;

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatDuration(run: Pick<PullRequestRun, "startedAt" | "endedAt">): string {
  if (!run.endedAt) return "";
  const seconds = Math.round((run.endedAt.getTime() - run.startedAt.getTime()) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatError(error: string | undefined): string {
  if (!error) return "";
  return error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH)}…` : error;
}

const VERDICT_LABELS: Record<Verdict, string> = {
  ship: "Ship",
  mergeable: "Mergeable",
  changes_needed: "Changes needed",
  blocked: "Blocked",
};

export function verdictLabel(verdict: Verdict): string {
  return VERDICT_LABELS[verdict];
}

const RUN_FAILURE_LABELS: Record<Exclude<PullRequestRun["status"], "running" | "ok">, string> = {
  "max-turns": "hit the turn limit",
  timeout: "ran out of time",
  error: "the harness failed",
  "invalid-output": "returned a result Hawkeye could not read",
  superseded: "was superseded by a newer push",
};

const PLAN_LIMIT_LABELS: Record<PlanLimit, string> = {
  "rate limit": "hit the plan's usage limit",
  overload: "the model was at capacity",
};

export function runFailureLabel(status: PullRequestRun["status"], error?: string): string {
  if (status === "running" || status === "ok") throw new Error(`${status} is not a failure`);
  const planLimit = runPlanLimit(status, error);
  return planLimit ? PLAN_LIMIT_LABELS[planLimit] : RUN_FAILURE_LABELS[status];
}

export function runPlanLimit(
  status: PullRequestRun["status"],
  error: string | null | undefined,
): PlanLimit | undefined {
  return status === "error" && error ? planLimitIn(error) : undefined;
}

const PLAN_LIMIT_NOTES: Record<PlanLimit, string> = {
  "rate limit": "Usage limit",
  overload: "Model at capacity",
};

export function planLimitNote(planLimit: PlanLimit): string {
  return PLAN_LIMIT_NOTES[planLimit];
}
