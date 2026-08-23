import type { ClaimedJob, RunEvent, RunResultReport } from "@hawkeye/core";

export class ControlPlaneRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ControlPlaneRequestError";
  }
}

export type ControlPlaneClient = {
  claimJob(options?: { signal?: AbortSignal }): Promise<ClaimedJob | undefined>;
  heartbeat(jobId: string): Promise<void>;
  sendEvents(runId: string, events: RunEvent[]): Promise<void>;
  sendResult(runId: string, report: RunResultReport): Promise<void>;
};

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

function claimedJob(payload: unknown): ClaimedJob {
  const root = record(payload, "payload");
  const job = record(root.job, "job");
  const pullRequest = record(root.pullRequest, "pullRequest");
  const settings = record(root.settings, "settings");
  const promptOverride = settings.promptOverride;
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
    },
  };
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
      if (response.status === 204) return undefined;
      return claimedJob(await response.json());
    },
    async heartbeat(jobId) {
      await send("POST", `/api/runner/jobs/${encodeURIComponent(jobId)}/heartbeat`, {});
    },
    async sendEvents(runId, events) {
      await send("POST", `/api/runner/runs/${encodeURIComponent(runId)}/events`, events);
    },
    async sendResult(runId, report) {
      await send("POST", `/api/runner/runs/${encodeURIComponent(runId)}/result`, report);
    },
  };
}
