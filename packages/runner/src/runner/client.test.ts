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
