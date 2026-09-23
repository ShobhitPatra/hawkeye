import type { Verdict } from "@hawkeye/core";
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

const POSTING_NOTE = "post: ";
const SHORT_FORM_NOTE = "; the short form was posted";

export type PostingNote = { kind: "short-form" | "not-posted"; detail: string };

export function postingNote(error: string | undefined): PostingNote | undefined {
  if (!error?.startsWith(POSTING_NOTE)) return undefined;
  const detail = error.slice(POSTING_NOTE.length);
  return detail.endsWith(SHORT_FORM_NOTE)
    ? { kind: "short-form", detail: detail.slice(0, -SHORT_FORM_NOTE.length) }
    : { kind: "not-posted", detail };
}

export function runFailureLabel(status: PullRequestRun["status"]): string {
  if (status === "running" || status === "ok") throw new Error(`${status} is not a failure`);
  return RUN_FAILURE_LABELS[status];
}
