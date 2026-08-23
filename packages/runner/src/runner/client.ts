import type { ClaimedJob, RunResultReport } from "@hawkeye/core";

export type RunEvent = { type: string; at: string; data?: unknown };

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
      return (await response.json()) as ClaimedJob;
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
