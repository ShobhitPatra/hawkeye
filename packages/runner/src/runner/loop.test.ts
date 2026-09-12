import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ClaimedJob, HarnessResult, HarnessSpec } from "@hawkeye/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlPlaneClient } from "./client.js";
import { type RunnerEvent, runRunnerLoop, type RunnerLoopDependencies } from "./loop.js";

const LENSES = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const review = {
  verdict: "ship",
  summary: "- fine",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [],
};
const claimedJob: ClaimedJob = {
  job: { id: "job-1", runId: "run-1", headSha: "a".repeat(40), baseSha: "b".repeat(40) },
  pullRequest: { owner: "o", repo: "r", number: 7 },
  installationToken: "ghs_job",
  settings: { maxTurns: 3, wallClockMinutes: 1, promptOverride: "ignored" },
};

type Received = { method: string; url: string; authorization?: string; body: unknown };

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

function fakeControlPlane(
  handle: (received: Received, response: ServerResponse) => void,
): Promise<{ server: Server; baseUrl: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer(async (request, response) => {
    const entry: Received = {
      method: request.method ?? "",
      url: request.url ?? "",
      body: await readBody(request),
      ...(request.headers.authorization === undefined
        ? {}
        : { authorization: request.headers.authorization }),
    };
    received.push(entry);
    handle(entry, response);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        received,
      }),
    ),
  );
}

function json(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function scripted(claims: (ClaimedJob | undefined)[], resultStatuses: number[] = [200]) {
  let claimIndex = 0;
  let resultIndex = 0;
  return (received: Received, response: ServerResponse) => {
    if (received.url === "/api/runner/jobs") {
      const claim = claims[claimIndex++];
      return claim === undefined ? json(response, 204) : json(response, 200, claim);
    }
    if (received.url.endsWith("/result")) {
      const status = resultStatuses[Math.min(resultIndex++, resultStatuses.length - 1)]!;
      return json(response, status, { ok: true, posted: "posted" });
    }
    return json(response, 200, { ok: true });
  };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function deps(
  baseUrl: string,
  overrides: Partial<RunnerLoopDependencies> & { harnessResult?: HarnessResult } = {},
): Promise<RunnerLoopDependencies & { logged: string[]; reported: RunnerEvent[] }> {
  const logged: string[] = [];
  const reported: RunnerEvent[] = [];
  const harness: HarnessSpec = {
    name: "fake",
    run: vi.fn(async (i): Promise<HarnessResult> => {
      i.onEvent({ type: "turn", turns: 1 });
      if (overrides.harnessResult) return overrides.harnessResult;
      await writeFile(i.resultPath, JSON.stringify(review));
      return { status: "ok", turns: 1 };
    }),
  };
  const root = await mkdtemp(join(tmpdir(), "hawkeye-loop-"));
  const { harnessResult: _ignored, ...rest } = overrides;
  return {
    client: createControlPlaneClient({ baseUrl, token: "hk_1", fetch }),
    harness,
    createWorktree: (async (i: { directory: string }) => {
      await mkdir(i.directory, { recursive: true });
      return {
        path: i.directory,
        diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
        remove: async () => {},
      };
    }) as never,
    readRepositoryRules: async () => [],
    createRunDirectory: async (reference) => {
      const directory = join(root, `${reference.owner}-${reference.repo}-${reference.number}`);
      await mkdir(directory, { recursive: true });
      return directory;
    },
    fetch: (async () =>
      Response.json({
        number: 7,
        title: "T",
        body: "",
        draft: false,
        user: { login: "alice" },
        head: { sha: "a".repeat(40), ref: "feature" },
        base: {
          sha: "b".repeat(40),
          ref: "main",
          repo: { clone_url: "https://github.com/o/r.git" },
        },
        commits: 1,
      })) as typeof fetch,
    report: (event) => reported.push(event),
    log: (line) => logged.push(line),
    heartbeatIntervalMs: 10,
    retryDelayMs: 1,
    emptyPollDelayMs: 1,
    resultRetryDelaysMs: [1, 1, 1],
    logged,
    reported,
    ...rest,
  };
}

async function promptOf(d: RunnerLoopDependencies): Promise<string> {
  await runRunnerLoop(d, { once: true });
  const input = (d.harness.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  return readFile(input.promptPath, "utf8");
}

describe("runRunnerLoop", () => {
  it("claims a job, reviews it and reports the result", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    const result = plane.received.find((r) => r.url === "/api/runner/runs/run-1/result");
    expect(result).toMatchObject({
      method: "POST",
      authorization: "Bearer hk_1",
      body: { status: "ok", turns: 1, result: review, commentable: { "a.txt": [1, 2] } },
    });
    expect(plane.received.some((r) => r.url === "/api/runner/runs/run-1/events")).toBe(true);
    expect(d.reported[0]).toEqual({ state: "claimed", subject: "o/r#7", headSha: "a".repeat(40) });
    expect(d.reported[1]).toMatchObject({ state: "reviewing" });
    expect(d.logged).toContain("turn 1");
    expect(d.reported[2]).toMatchObject({ state: "posted", result: review, turns: 1 });
    const harnessInput = (d.harness.run as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(harnessInput).toMatchObject({ maxTurns: 3, wallClockMs: 60_000 });
  });
  it("heartbeats while the review runs", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    d.harness = {
      name: "slow",
      run: async (i) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        await writeFile(i.resultPath, JSON.stringify(review));
        return { status: "ok", turns: 1 };
      },
    };
    await runRunnerLoop(d, { once: true });
    const beats = plane.received.filter((r) => r.url === "/api/runner/jobs/job-1/heartbeat");
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0]).toMatchObject({ method: "POST", authorization: "Bearer hk_1" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(plane.received.filter((r) => r.url === "/api/runner/jobs/job-1/heartbeat").length).toBe(
      beats.length,
    );
  });
  it("stops the review and reports it superseded when a heartbeat says so", async () => {
    let beats = 0;
    const plane = await fakeControlPlane((received, response) => {
      if (received.url === "/api/runner/jobs") return json(response, 200, claimedJob);
      if (received.url.endsWith("/heartbeat"))
        return json(response, 200, { ok: true, superseded: ++beats >= 2 });
      if (received.url.endsWith("/result")) return json(response, 200, { ok: true });
      return json(response, 200, { ok: true });
    });
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    d.harness = {
      name: "abortable",
      run: (i) =>
        new Promise((resolve) => {
          i.signal?.addEventListener("abort", () => resolve({ status: "superseded", turns: 2 }));
        }),
    };
    await runRunnerLoop(d, { once: true });
    const result = plane.received.find((r) => r.url.endsWith("/result"));
    expect(result?.body).toMatchObject({ status: "superseded", turns: 2 });
    expect(d.reported.map((e) => e.state)).toContain("superseded");
    expect(d.reported.map((e) => e.state)).not.toContain("failed");
  });

  it("reports a harness failure with its status", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl, {
      harnessResult: { status: "max-turns", turns: 3 },
    });
    await runRunnerLoop(d, { once: true });
    expect(plane.received.find((r) => r.url.endsWith("/result"))?.body).toEqual({
      status: "max-turns",
      turns: 3,
      error: "stopped without a message",
    });
    expect(d.reported.slice(-2)).toEqual([
      {
        state: "failed",
        detail: expect.stringMatching(/^stopped without a message after 3 turns · run kept in /),
      },
      { state: "delivered", detail: "the control plane recorded the failure" },
    ]);
  });
  it.each([
    ["already-posted", { state: "skipped", detail: "already posted for aaaaaaa" }],
    ["superseded", { state: "skipped", detail: "superseded by a newer push" }],
    ["failed", { state: "failed", detail: "the control plane could not post the review" }],
    [undefined, { state: "delivered", detail: "the control plane recorded the result" }],
  ])("reports a review acknowledged as %s", async (posted, event) => {
    const plane = await fakeControlPlane((received, response) => {
      if (received.url === "/api/runner/jobs") return json(response, 200, claimedJob);
      if (received.url.endsWith("/result"))
        return json(response, 200, posted === undefined ? { ok: true } : { ok: true, posted });
      return json(response, 200, { ok: true });
    });
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    expect(d.reported.at(-1)).toEqual(event);
  });
  it("reports an error when the review cannot even start", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl, {
      createWorktree: (async () => {
        throw new Error("git fetch failed");
      }) as never,
    });
    await runRunnerLoop(d, { once: true });
    expect(plane.received.find((r) => r.url.endsWith("/result"))?.body).toEqual({
      status: "error",
      turns: 0,
      error: "git fetch failed",
    });
    expect(d.reported).toContainEqual({
      state: "failed",
      detail: expect.stringMatching(/^git fetch failed after 0 turns · run kept in /),
    });
  });
  it("exits with the message when the token is rejected", async () => {
    const plane = await fakeControlPlane((_received, response) =>
      json(response, 401, { error: "invalid runner token" }),
    );
    servers.push(plane.server);
    await expect(runRunnerLoop(await deps(plane.baseUrl))).rejects.toThrow(
      "control plane GET /api/runner/jobs failed: 401 invalid runner token",
    );
  });
  it("keeps going when the claim is lost before the result lands", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob], [409]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    expect(d.reported).toContainEqual({
      state: "failed",
      detail: "result dropped: the claim was lost",
    });
  });
  it("polls again after an empty claim and retries after a failed claim", async () => {
    let calls = 0;
    const plane = await fakeControlPlane((received, response) => {
      if (received.url === "/api/runner/jobs") {
        calls += 1;
        if (calls === 1) return json(response, 204);
        if (calls === 2) return json(response, 500, { error: "db down" });
        return json(response, 200, claimedJob);
      }
      return json(response, 200, { ok: true });
    });
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    let claimed = 0;
    const controller = new AbortController();
    d.signal = controller.signal;
    d.harness = {
      name: "counting",
      run: async (i) => {
        claimed += 1;
        await writeFile(i.resultPath, JSON.stringify(review));
        controller.abort();
        return { status: "ok", turns: 1 };
      },
    };
    await runRunnerLoop(d);
    expect(claimed).toBe(1);
    expect(calls).toBe(3);
    expect(d.reported).toContainEqual({
      state: "waiting",
      detail:
        "claim failed: control plane GET /api/runner/jobs failed: 500 db down; retrying in 0.001s",
    });
    expect(plane.received.find((r) => r.url.endsWith("/result"))?.body).toMatchObject({
      status: "ok",
    });
  });
  it("stops a long poll when aborted", async () => {
    const plane = await fakeControlPlane((_received, response) => {
      setTimeout(() => json(response, 204), 5_000).unref();
    });
    servers.push(plane.server);
    const controller = new AbortController();
    const d = await deps(plane.baseUrl, { signal: controller.signal });
    const loop = runRunnerLoop(d);
    setTimeout(() => controller.abort(), 20);
    await expect(loop).resolves.toBeUndefined();
  });
  it("uses the job's prompt override unless a local contract override is given", async () => {
    const withJobRules = {
      ...claimedJob,
      settings: { ...claimedJob.settings, promptOverride: "JOB RULES" },
    };
    const plane = await fakeControlPlane(scripted([withJobRules, withJobRules]));
    servers.push(plane.server);
    expect(await promptOf(await deps(plane.baseUrl))).toContain("JOB RULES");
    const local = await promptOf(await deps(plane.baseUrl, { contractOverride: "LOCAL RULES" }));
    expect(local).toContain("LOCAL RULES");
    expect(local).not.toContain("JOB RULES");
  });
  it("feeds the claimed previous round into the review prompt", async () => {
    const withPrevious: ClaimedJob = {
      ...claimedJob,
      previousRound: {
        headSha: "e".repeat(40),
        findings: [
          {
            id: "abc123def456",
            severity: "should_fix",
            claim: "Leaks a handle",
            detail: "Close it before returning.",
          },
        ],
      },
    };
    const plane = await fakeControlPlane(scripted([withPrevious]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl, {
      createWorktree: (async (i: { directory: string; previousHeadSha?: string }) => {
        await mkdir(i.directory, { recursive: true });
        expect(i.previousHeadSha).toBe("e".repeat(40));
        return {
          path: i.directory,
          diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
          interdiff: "INTERDIFF-FIXTURE-TEXT",
          remove: async () => {},
        };
      }) as never,
    });
    const prompt = await promptOf(d);
    expect(prompt).toContain(`The previous round reviewed head ${"e".repeat(40)}`);
    expect(prompt).toContain("Leaks a handle");
    expect(prompt).toContain("INTERDIFF-FIXTURE-TEXT");
  });
  it("interrupts the claim-retry sleep when aborted", async () => {
    const plane = await fakeControlPlane((_received, response) =>
      json(response, 500, { error: "db down" }),
    );
    servers.push(plane.server);
    const controller = new AbortController();
    const d = await deps(plane.baseUrl, { signal: controller.signal, retryDelayMs: 5_000 });
    const loop = runRunnerLoop(d);
    setTimeout(() => controller.abort(), 20);
    await expect(loop).resolves.toBeUndefined();
  });
  it("does not wait when the signal is already aborted", async () => {
    const controller = new AbortController();
    const d = await deps("http://127.0.0.1:1", {
      signal: controller.signal,
      emptyPollDelayMs: 30_000,
    });
    d.client = {
      claimJob: async () => {
        controller.abort();
        return undefined;
      },
      heartbeat: async () => ({ superseded: false }),
      sendEvents: async () => {},
      sendResult: async () => ({ ok: true }),
    };
    const started = Date.now();
    await runRunnerLoop(d);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
  it("returns after one empty poll with once", async () => {
    const plane = await fakeControlPlane(scripted([]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    expect(d.reported).toContainEqual({ state: "idle", detail: "no job queued" });
  });
  it("retries the result after a 5xx and delivers it", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob], [503, 502, 200]));
    servers.push(plane.server);
    const sleeps: number[] = [];
    const d = await deps(plane.baseUrl, {
      resultRetryDelaysMs: [2, 4, 8],
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });
    await runRunnerLoop(d, { once: true });
    expect(plane.received.filter((r) => r.url.endsWith("/result")).length).toBe(3);
    expect(sleeps).toEqual([2, 4]);
    expect(d.reported.filter((event) => event.state === "waiting")).toHaveLength(2);
    expect(d.reported.at(-1)).toMatchObject({ state: "posted", turns: 1 });
  });
  it("keeps the daemon running when the result cannot be delivered", async () => {
    let claims = 0;
    const plane = await fakeControlPlane((received, response) => {
      if (received.url === "/api/runner/jobs") {
        claims += 1;
        return claims === 1 ? json(response, 200, claimedJob) : json(response, 204);
      }
      if (received.url.endsWith("/result")) return json(response, 500, { error: "db down" });
      return json(response, 200, { ok: true });
    });
    servers.push(plane.server);
    const controller = new AbortController();
    const d = await deps(plane.baseUrl, {
      signal: controller.signal,
      sleep: async (milliseconds) => {
        if (milliseconds === 1 && claims >= 2) controller.abort();
      },
    });
    await runRunnerLoop(d);
    expect(plane.received.filter((r) => r.url.endsWith("/result")).length).toBe(4);
    expect(claims).toBe(2);
    expect(d.reported.at(-1)).toMatchObject({
      state: "failed",
      detail: expect.stringMatching(
        /^result not delivered: control plane POST \/api\/runner\/runs\/run-1\/result failed: 500 db down · run kept in /,
      ),
    });
  });
  it("exits non-zero with once when the result cannot be delivered", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob], [500]));
    servers.push(plane.server);
    await expect(runRunnerLoop(await deps(plane.baseUrl), { once: true })).rejects.toThrow(
      "the result was not delivered",
    );
  });
  it("does not retry a result the control plane rejects as invalid", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob], [400]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await expect(runRunnerLoop(d, { once: true })).rejects.toThrow("the result was not delivered");
    expect(plane.received.filter((r) => r.url.endsWith("/result")).length).toBe(1);
  });
  it("gives up with once after three failed claims", async () => {
    let calls = 0;
    const plane = await fakeControlPlane((_received, response) => {
      calls += 1;
      json(response, 500, { error: "db down" });
    });
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await expect(runRunnerLoop(d, { once: true })).rejects.toThrow(
      "claim failed 3 times: control plane GET /api/runner/jobs failed: 500 db down",
    );
    expect(calls).toBe(3);
    expect(d.reported.filter((event) => event.state === "waiting")).toHaveLength(2);
  });
  it("waits before polling again after an empty claim", async () => {
    let calls = 0;
    const plane = await fakeControlPlane((_received, response) => {
      calls += 1;
      json(response, 204);
    });
    servers.push(plane.server);
    const controller = new AbortController();
    const sleeps: number[] = [];
    const d = await deps(plane.baseUrl, {
      signal: controller.signal,
      emptyPollDelayMs: 250,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length === 3) controller.abort();
      },
    });
    await runRunnerLoop(d);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([250, 250, 250]);
  });
});
