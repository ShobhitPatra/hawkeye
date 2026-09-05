import type { Verdict } from "@hawkeye/core";
import type { PullRequestFinding, PullRequestRun } from "./runs";

const MAX_ERROR_LENGTH = 120;

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatVerdict(run: Pick<PullRequestRun, "verdict" | "reportedVerdict">): string {
  if (!run.verdict) return "";
  const verdict = verdictLabel(run.verdict);
  if (run.reportedVerdict && run.reportedVerdict !== run.verdict)
    return `${verdict} (reported ${verdictLabel(run.reportedVerdict)})`;
  return verdict;
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

export function formatFindingLocation(finding: Pick<PullRequestFinding, "path" | "line">): string {
  if (!finding.path) return "";
  return finding.line === null ? ` (${finding.path})` : ` (${finding.path}:${finding.line})`;
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
