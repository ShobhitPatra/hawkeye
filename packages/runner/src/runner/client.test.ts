import { describe, expect, it, vi } from "vitest";
import { ControlPlaneRequestError, createControlPlaneClient } from "./client.js";

const job = {
  job: { id: "j1", runId: "r1", headSha: "a".repeat(40), baseSha: "b".repeat(40) },
  pullRequest: { owner: "o", repo: "r", number: 1 },
  installationToken: "ghs_t",
  settings: { maxTurns: 10, wallClockMinutes: 5 },
};

function client(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
  return {
    fetch,
    client: createControlPlaneClient({
      baseUrl: "https://hawkeye.example/",
      token: "hk_1",
      fetch: fetch as unknown as typeof globalThis.fetch,
    }),
  };
}

describe("createControlPlaneClient", () => {
  it("claims a job with the runner token", async () => {
    const { fetch, client: c } = client(() => Response.json(job));
    expect(await c.claimJob()).toEqual(job);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://hawkeye.example/api/runner/jobs");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hk_1");
  });
  it("returns nothing on 204", async () => {
    const { client: c } = client(() => new Response(null, { status: 204 }));
    expect(await c.claimJob()).toBeUndefined();
  });
  it("passes the abort signal through to the claim request", async () => {
    const controller = new AbortController();
    const { fetch, client: c } = client(() => new Response(null, { status: 204 }));
    await c.claimJob({ signal: controller.signal });
    expect(fetch.mock.calls[0]![1].signal).toBe(controller.signal);
  });
  it("throws a typed error with the status and server message", async () => {
    const { client: c } = client(() =>
      Response.json({ error: "invalid runner token" }, { status: 401 }),
    );
    const error = await c.claimJob().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ControlPlaneRequestError);
    expect((error as ControlPlaneRequestError).status).toBe(401);
    expect((error as Error).message).toBe(
      "control plane GET /api/runner/jobs failed: 401 invalid runner token",
    );
  });
  it("posts heartbeats, events and results as JSON", async () => {
    const { fetch, client: c } = client(() => Response.json({ ok: true }));
    await c.heartbeat("j 1");
    await c.sendEvents("r1", [{ type: "turn", at: "2026-01-01T00:00:00.000Z" }]);
    await c.sendResult("r1", { status: "error", turns: 2, error: "boom" });
    const calls = fetch.mock.calls.map(([url, init]) => ({
      url,
      method: init.method,
      body: init.body,
      contentType: (init.headers as Record<string, string>)["Content-Type"],
    }));
    expect(calls).toEqual([
      {
        url: "https://hawkeye.example/api/runner/jobs/j%201/heartbeat",
        method: "POST",
        body: "{}",
        contentType: "application/json",
      },
      {
        url: "https://hawkeye.example/api/runner/runs/r1/events",
        method: "POST",
        body: JSON.stringify([{ type: "turn", at: "2026-01-01T00:00:00.000Z" }]),
        contentType: "application/json",
      },
      {
        url: "https://hawkeye.example/api/runner/runs/r1/result",
        method: "POST",
        body: JSON.stringify({ status: "error", turns: 2, error: "boom" }),
        contentType: "application/json",
      },
    ]);
  });
  it("surfaces a lost claim on result as a 409 error", async () => {
    const { client: c } = client(() =>
      Response.json({ error: "job is no longer claimed by this runner" }, { status: 409 }),
    );
    await expect(c.sendResult("r1", { status: "ok", turns: 1 })).rejects.toMatchObject({
      status: 409,
    });
  });
});
