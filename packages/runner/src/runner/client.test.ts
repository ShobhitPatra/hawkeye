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
  it("parses a previous round with a dismissed finding", async () => {
    const withRound = {
      ...job,
      previousRound: {
        headSha: "c".repeat(40),
        findings: [
          {
            id: "abc123abc123",
            severity: "should_fix",
            claim: "Bug",
            detail: "wrong",
            path: "x.ts",
            line: 3,
            dismissed: { note: "by design" },
          },
        ],
      },
    };
    const { client: c } = client(() => Response.json(withRound));
    expect(await c.claimJob()).toEqual(withRound);
    const bad = {
      ...withRound,
      previousRound: { ...withRound.previousRound, findings: [{ id: "x" }] },
    };
    const { client: rejecting } = client(() => Response.json(bad));
    await expect(rejecting.claimJob()).rejects.toThrow(
      "invalid claimed job payload: previousRound.findings[0].severity",
    );
  });
  it("reads whether a heartbeat says the job is superseded", async () => {
    const { client: fresh } = client(() => Response.json({ ok: true, superseded: true }));
    await expect(fresh.heartbeat("j1")).resolves.toEqual({ superseded: true });
    const { client: old } = client(() => Response.json({ ok: true }));
    await expect(old.heartbeat("j1")).resolves.toEqual({ superseded: false });
  });

  it("returns nothing on 204", async () => {
    const { client: c } = client(() => new Response(null, { status: 204 }));
    expect(await c.claimJob()).toBeUndefined();
  });
  it("reads how long to wait from a 204's Retry-After, and ignores one it cannot trust", async () => {
    const answer = (header: string) =>
      client(() => new Response(null, { status: 204, headers: { "Retry-After": header } })).client;
    expect(await answer("60").claimJob()).toEqual({ retryAfterMs: 60_000 });
    for (const header of ["0", "301", "1.5", "soon", "-5"])
      expect(await answer(header).claimJob()).toBeUndefined();
  });
  it("tells the control plane on a claim that it reads Retry-After", async () => {
    const { fetch, client: c } = client(() => new Response(null, { status: 204 }));
    await c.claimJob();
    const sent = (call: number) =>
      new Headers(fetch.mock.calls[call]![1].headers).get("X-Hawkeye-Honors-Retry-After");
    expect(sent(0)).toBe("1");
    await c.heartbeat("j1").catch(() => {});
    expect(sent(1)).toBeNull();
  });
  it("passes the abort signal through to the claim request", async () => {
    const controller = new AbortController();
    const { fetch, client: c } = client(() => new Response(null, { status: 204 }));
    await c.claimJob({ signal: controller.signal });
    const passed = fetch.mock.calls[0]![1].signal as AbortSignal;
    expect(passed.aborted).toBe(false);
    controller.abort();
    expect(passed.aborted).toBe(true);
  });
  it("gives up on a request the control plane never answers", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const c = createControlPlaneClient({
      baseUrl: "https://hawkeye.example",
      token: "hk_1",
      fetch: fetch as unknown as typeof globalThis.fetch,
      requestTimeoutMs: 20,
      claimRequestTimeoutMs: 40,
    });
    const started = Date.now();
    await expect(c.claimJob()).rejects.toThrow(
      "control plane GET /api/runner/jobs did not answer within 0.04s",
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
    await expect(c.heartbeat("job-1")).rejects.toThrow("did not answer within 0.02s");
  });
  it("gives the result report its own longer limit and names a body that stalls", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const c = createControlPlaneClient({
      baseUrl: "https://hawkeye.example",
      token: "hk_1",
      fetch: (async () => stalled) as unknown as typeof globalThis.fetch,
      requestTimeoutMs: 20,
      resultRequestTimeoutMs: 60,
    });
    const started = Date.now();
    await expect(c.sendResult("run-1", { status: "error", turns: 0, error: "x" })).rejects.toThrow(
      "control plane POST /api/runner/runs/run-1/result did not answer within 0.06s",
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
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
  it("returns the posting outcome acknowledged for a result", async () => {
    const { client: c } = client(() => Response.json({ ok: true, posted: "already-posted" }));
    await expect(c.sendResult("r1", { status: "ok", turns: 1 })).resolves.toEqual({
      ok: true,
      posted: "already-posted",
    });
  });
  it("passes an unknown posting outcome through", async () => {
    const { client: c } = client(() => Response.json({ ok: true, posted: "deferred" }));
    await expect(c.sendResult("r1", { status: "ok", turns: 1 })).resolves.toEqual({
      ok: true,
      posted: "deferred",
    });
  });
  it("posts heartbeats, events and results as JSON", async () => {
    const { fetch, client: c } = client(() => Response.json({ ok: true }));
    await c.heartbeat("j 1");
    await c.sendEvents("r1", [{ type: "turn", at: "2026-01-01T00:00:00.000Z" }]);
    await expect(c.sendResult("r1", { status: "error", turns: 2, error: "boom" })).resolves.toEqual(
      {
        ok: true,
      },
    );
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
  it("rejects a malformed claimed job payload", async () => {
    const cases: [unknown, string][] = [
      ["not an object", "payload"],
      [{ ...job, job: { ...job.job, runId: 7 } }, "job.runId"],
      [{ ...job, pullRequest: { ...job.pullRequest, number: "7" } }, "pullRequest.number"],
      [{ ...job, installationToken: null }, "installationToken"],
      [{ ...job, settings: { maxTurns: 10, wallClockMinutes: 1.5 } }, "settings.wallClockMinutes"],
      [{ ...job, settings: { ...job.settings, promptOverride: 5 } }, "settings.promptOverride"],
      [{ ...job, settings: { ...job.settings, model: 5 } }, "settings.model"],
      [{ ...job, settings: { ...job.settings, harness: true } }, "settings.harness"],
      [{ ...job, settings: { ...job.settings, concurrency: "2" } }, "settings.concurrency"],
      [{ ...job, settings: { ...job.settings, concurrency: 0 } }, "settings.concurrency"],
    ];
    for (const [payload, field] of cases) {
      const { client: c } = client(() => Response.json(payload));
      await expect(c.claimJob()).rejects.toThrow(`invalid claimed job payload: ${field}`);
    }
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
