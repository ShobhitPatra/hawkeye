import {
  SEVERITIES,
  type ClaimedJob,
  type PriorFinding,
  type RunEvent,
  type RunResultReport,
  type Severity,
} from "@hawkeye/core";

export type ResultAcknowledgement = { ok: true; posted?: string };

export class ControlPlaneRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneRequestError";
  }
}

export type HeartbeatAcknowledgement = { superseded: boolean };

export type ClaimWait = { retryAfterMs: number };
export const MAX_RETRY_AFTER_SECONDS = 300;

export type ControlPlaneClient = {
  claimJob(options?: { signal?: AbortSignal }): Promise<ClaimedJob | ClaimWait | undefined>;
  heartbeat(jobId: string): Promise<HeartbeatAcknowledgement>;
  sendEvents(runId: string, events: RunEvent[]): Promise<void>;
  sendResult(runId: string, report: RunResultReport): Promise<ResultAcknowledgement>;
};

function acknowledgement(payload: unknown): ResultAcknowledgement {
  const posted =
    typeof payload === "object" && payload !== null
      ? (payload as { posted?: unknown }).posted
      : undefined;
  return typeof posted === "string" ? { ok: true, posted } : { ok: true };
}

function invalid(field: string): never {
  throw new Error(`invalid claimed job payload: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : invalid(field);
}

function text(value: unknown, field: string): string {
  return typeof value === "string" ? value : invalid(field);
}

function integer(value: unknown, field: string): number {
  return Number.isInteger(value) ? (value as number) : invalid(field);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = integer(value, field);
  return parsed >= 1 ? parsed : invalid(field);
}

function priorFinding(value: unknown, field: string): PriorFinding {
  const entry = record(value, field);
  const severity = text(entry.severity, `${field}.severity`);
  if (!SEVERITIES.includes(severity as Severity)) invalid(`${field}.severity`);
  return {
    id: text(entry.id, `${field}.id`),
    severity: severity as Severity,
    claim: text(entry.claim, `${field}.claim`),
    detail: text(entry.detail, `${field}.detail`),
    ...(entry.path === undefined ? {} : { path: text(entry.path, `${field}.path`) }),
    ...(entry.line === undefined ? {} : { line: integer(entry.line, `${field}.line`) }),
    ...(entry.dismissed === undefined
      ? {}
      : {
          dismissed: {
            note: text(
              record(entry.dismissed, `${field}.dismissed`).note,
              `${field}.dismissed.note`,
            ),
          },
        }),
  };
}

function previousRound(value: unknown): NonNullable<ClaimedJob["previousRound"]> {
  const round = record(value, "previousRound");
  if (!Array.isArray(round.findings)) invalid("previousRound.findings");
  return {
    headSha: text(round.headSha, "previousRound.headSha"),
    findings: (round.findings as unknown[]).map((entry, index) =>
      priorFinding(entry, `previousRound.findings[${index}]`),
    ),
  };
}

function claimedJob(payload: unknown): ClaimedJob {
  const root = record(payload, "payload");
  const job = record(root.job, "job");
  const pullRequest = record(root.pullRequest, "pullRequest");
  const settings = record(root.settings, "settings");
  const promptOverride = settings.promptOverride;
  const model = settings.model;
  const harness = settings.harness;
  const concurrency = settings.concurrency;
  return {
    job: {
      id: text(job.id, "job.id"),
      runId: text(job.runId, "job.runId"),
      headSha: text(job.headSha, "job.headSha"),
      baseSha: text(job.baseSha, "job.baseSha"),
    },
    pullRequest: {
      owner: text(pullRequest.owner, "pullRequest.owner"),
      repo: text(pullRequest.repo, "pullRequest.repo"),
      number: integer(pullRequest.number, "pullRequest.number"),
    },
    installationToken: text(root.installationToken, "installationToken"),
    settings: {
      maxTurns: integer(settings.maxTurns, "settings.maxTurns"),
      wallClockMinutes: integer(settings.wallClockMinutes, "settings.wallClockMinutes"),
      ...(promptOverride === undefined
        ? {}
        : { promptOverride: text(promptOverride, "settings.promptOverride") }),
      ...(model === undefined ? {} : { model: text(model, "settings.model") }),
      ...(harness === undefined ? {} : { harness: text(harness, "settings.harness") }),
      ...(concurrency === undefined
        ? {}
        : { concurrency: positiveInteger(concurrency, "settings.concurrency") }),
    },
    ...(root.previousRound === undefined
      ? {}
      : { previousRound: previousRound(root.previousRound) }),
  };
}

function claimWait(header: string | null): ClaimWait | undefined {
  if (header === null || !/^\d+$/.test(header)) return undefined;
  const seconds = Number(header);
  if (seconds < 1 || seconds > MAX_RETRY_AFTER_SECONDS) return undefined;
  return { retryAfterMs: seconds * 1000 };
}

export function createControlPlaneClient(input: {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
}): ControlPlaneClient {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");

  async function send(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await input.fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ControlPlaneRequestError(
        response.status,
        `control plane ${method} ${path} failed: ${response.status}${payload.error ? ` ${payload.error}` : ""}`,
      );
    }
    return response;
  }

  return {
    async claimJob(options = {}) {
      const response = await send("GET", "/api/runner/jobs", undefined, options.signal);
      if (response.status === 204) return claimWait(response.headers.get("retry-after"));
      return claimedJob(await response.json());
    },
    async heartbeat(jobId) {
      const response = await send(
        "POST",
        `/api/runner/jobs/${encodeURIComponent(jobId)}/heartbeat`,
        {},
      );
      const payload = (await response.json().catch(() => ({}))) as { superseded?: unknown };
      return { superseded: payload.superseded === true };
    },
    async sendEvents(runId, events) {
      await send("POST", `/api/runner/runs/${encodeURIComponent(runId)}/events`, events);
    },
    async sendResult(runId, report) {
      const response = await send(
        "POST",
        `/api/runner/runs/${encodeURIComponent(runId)}/result`,
        report,
      );
      return acknowledgement(await response.json());
    },
  };
}
