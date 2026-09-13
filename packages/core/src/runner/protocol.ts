import type { PriorFinding } from "../contract/prompt.js";
import type { ReviewResult } from "../contract/schema.js";

export type ClaimedJob = {
  job: {
    id: string;
    runId: string;
    headSha: string;
    baseSha: string;
  };
  pullRequest: {
    owner: string;
    repo: string;
    number: number;
  };
  installationToken: string;
  settings: {
    maxTurns: number;
    wallClockMinutes: number;
    promptOverride?: string;
    model?: string;
    harness?: string;
  };
  previousRound?: { headSha: string; findings: PriorFinding[] };
};

export const RUN_RESULT_STATUSES = [
  "ok",
  "max-turns",
  "timeout",
  "error",
  "invalid-output",
  "superseded",
] as const;

export type RunResultStatus = (typeof RUN_RESULT_STATUSES)[number];

export type RunResultReport = {
  status: RunResultStatus;
  turns: number;
  result?: ReviewResult;
  error?: string;
  commentable?: Record<string, number[]>;
};

export type RunEvent = { type: string; at: string; data?: unknown };
