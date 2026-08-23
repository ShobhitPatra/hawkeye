import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ClaimedJob, HarnessResult, HarnessSpec } from "@hawkeye/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlPlaneClient } from "./client.js";
import { runRunnerLoop, type RunnerLoopDependencies } from "./loop.js";

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

function scripted(claims: (ClaimedJob | undefined)[], resultStatus = 200) {
  let claimIndex = 0;
  return (received: Received, response: ServerResponse) => {
    if (received.url === "/api/runner/jobs") {
      const claim = claims[claimIndex++];
      return claim === undefined ? json(response, 204) : json(response, 200, claim);
    }
    if (received.url.endsWith("/result")) return json(response, resultStatus, { ok: true });
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
): Promise<RunnerLoopDependencies & { logged: string[] }> {
  const logged: string[] = [];
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
      return { path: i.directory, diff: "diff", remove: async () => {} };
    }) as never,
    readRepositoryRules: async () => [],
    createRunDirectory: async (reference) => {
      const directory = join(root, `${reference.owner}-${reference.repo}-${reference.number}`);
      await mkdir(directory, { recursive: true });
      return directory;
    },
    fetch: (async () =>
      Response.json({ title: "T", body: "", user: { login: "alice" } })) as typeof fetch,
    log: (line) => logged.push(line),
    heartbeatIntervalMs: 10,
    retryDelayMs: 1,
    logged,
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
      body: { status: "ok", turns: 1, result: review },
    });
    expect(plane.received.some((r) => r.url === "/api/runner/runs/run-1/events")).toBe(true);
    expect(d.logged).toContain("job claimed: o/r#7 head aaaaaaa");
    expect(d.logged).toContain("turn 1");
    expect(d.logged).toContain("result ok after 1 turn(s)");
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
      error: "harness max-turns",
    });
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
    const plane = await fakeControlPlane(scripted([claimedJob], 409));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    expect(d.logged).toContain("result ok dropped: the claim was lost");
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
    expect(d.logged).toContain(
      "claim failed: control plane GET /api/runner/jobs failed: 500 db down",
    );
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
  it("returns after one empty poll with once", async () => {
    const plane = await fakeControlPlane(scripted([]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    await runRunnerLoop(d, { once: true });
    expect(d.logged).toContain("no job queued");
  });
});
