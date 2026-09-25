import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ClaimedJob, HarnessResult, HarnessSpec } from "@hawkeye/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createControlPlaneClient } from "./client.js";
import {
  type RunnerEvent,
  runRunnerLoop,
  type RunnerLoopDependencies,
  SLEEP_GAP_MS,
  sleptFor,
  watchClock,
} from "./loop.js";

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
  settings: { maxTurns: 3, wallClockMinutes: 1, promptOverride: "ignored", model: "sonnet" },
};

const pool = (job: ClaimedJob): ClaimedJob => ({
  ...job,
  settings: { ...job.settings, concurrency: 2 },
});

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

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
        updated_at: "2026-01-01T00:00:00Z",
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
    expect(harnessInput).toMatchObject({ maxTurns: 3, model: "sonnet" });
    expect(harnessInput.wallClockMs).toBeLessThanOrEqual(60_000);
    expect(harnessInput.wallClockMs).toBeGreaterThan(59_000);
  });
  it("runs up to the job's concurrency at once and numbers the slots", async () => {
    const second: ClaimedJob = {
      ...claimedJob,
      job: { ...claimedJob.job, id: "job-2", runId: "run-2" },
      pullRequest: { owner: "o", repo: "r", number: 8 },
    };
    const plane = await fakeControlPlane(scripted([pool(claimedJob), pool(second)]));
    servers.push(plane.server);
    const stop = new AbortController();
    const d = await deps(plane.baseUrl, { signal: stop.signal });
    let started = 0;
    const { promise: bothStarted, open: release } = gate();
    d.harness = {
      name: "gate",
      run: async (i) => {
        started += 1;
        if (started === 2) release();
        await bothStarted;
        await writeFile(i.resultPath, JSON.stringify(review));
        return { status: "ok", turns: 1 };
      },
    };
    const loop = runRunnerLoop(d);
    await bothStarted;
    stop.abort();
    await loop;
    const claimedEvents = d.reported.filter((event) => event.state === "claimed");
    expect(claimedEvents.map((event) => event.slot)).toEqual([1, 2]);
    expect(
      d.reported
        .filter((event) => event.state === "posted")
        .map((event) => event.slot ?? 0)
        .toSorted((a, b) => a - b),
    ).toEqual([1, 2]);
    expect(plane.received.filter((r) => r.url.endsWith("/result"))).toHaveLength(2);
  });

  it("stops a running review as soon as it claims a newer job for the same pull request", async () => {
    const newer: ClaimedJob = {
      ...claimedJob,
      job: { ...claimedJob.job, id: "job-2", runId: "run-2", headSha: "c".repeat(40) },
    };
    let reviewing = false;
    let served = 0;
    const plane = await fakeControlPlane((received, response) => {
      if (received.url === "/api/runner/jobs") {
        if (served === 0 || (served === 1 && reviewing)) {
          served += 1;
          return json(response, 200, pool(served === 1 ? claimedJob : newer));
        }
        return json(response, 204);
      }
      return json(response, 200, { ok: true, posted: "posted" });
    });
    servers.push(plane.server);
    const stop = new AbortController();
    const d = await deps(plane.baseUrl, { signal: stop.signal, heartbeatIntervalMs: 60_000 });
    d.harness = {
      name: "until-stopped",
      run: async (i) => {
        if (!reviewing) {
          reviewing = true;
          await new Promise<void>((resolve) =>
            i.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
          return { status: "superseded", turns: 0 };
        }
        await writeFile(i.resultPath, JSON.stringify(review));
        return { status: "ok", turns: 1 };
      },
    };
    const loop = runRunnerLoop(d);
    await vi.waitFor(() =>
      expect(plane.received.filter((r) => r.url.endsWith("/result"))).toHaveLength(2),
    );
    stop.abort();
    await loop;
    const results = plane.received.filter((r) => r.url.endsWith("/result"));
    expect(results.map((r) => [r.url, (r.body as { status: string }).status])).toEqual(
      expect.arrayContaining([
        ["/api/runner/runs/run-1/result", "superseded"],
        ["/api/runner/runs/run-2/result", "ok"],
      ]),
    );
    expect(d.reported.some((event) => event.state === "superseded" && event.slot === 1)).toBe(true);
  });

  it("runs one job at a time and carries no slot when concurrency is one", async () => {
    const second: ClaimedJob = {
      ...claimedJob,
      job: { ...claimedJob.job, id: "job-2", runId: "run-2" },
      pullRequest: { owner: "o", repo: "r", number: 8 },
    };
    const plane = await fakeControlPlane(scripted([claimedJob, second]));
    servers.push(plane.server);
    const stop = new AbortController();
    const d = await deps(plane.baseUrl, { signal: stop.signal });
    const { promise: held, open: release } = gate();
    let runs = 0;
    d.harness = {
      name: "gate",
      run: async (i) => {
        runs += 1;
        if (runs === 1) await held;
        await writeFile(i.resultPath, JSON.stringify(review));
        return { status: "ok", turns: 1 };
      },
    };
    const loop = runRunnerLoop(d);
    await vi.waitFor(() => expect(runs).toBe(1));
    expect(plane.received.filter((r) => r.url === "/api/runner/jobs")).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(runs).toBe(2));
    stop.abort();
    await loop;
    expect(d.reported.filter((event) => event.state === "claimed")).toHaveLength(2);
    expect(d.reported.every((event) => event.slot === undefined)).toBe(true);
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

  it("reports the refused model with an ok result after the review on the default", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl);
    vi.mocked(d.harness.run).mockImplementationOnce(async () => ({
      status: "error",
      turns: 0,
      error: "Model sonnet was refused by the claude CLI; choose another in Settings.",
      refusedModel: "sonnet",
    }));
    await runRunnerLoop(d, { once: true });
    expect(plane.received.find((r) => r.url.endsWith("/result"))?.body).toMatchObject({
      status: "ok",
      refusedModel: "sonnet",
    });
  });

  it("reports the refused model when the review on the default fails too", async () => {
    const plane = await fakeControlPlane(scripted([claimedJob]));
    servers.push(plane.server);
    const d = await deps(plane.baseUrl, {
      harnessResult: {
        status: "error",
        turns: 0,
        error: "Model sonnet was refused by the claude CLI; choose another in Settings.",
        refusedModel: "sonnet",
      },
    });
    await runRunnerLoop(d, { once: true });
    expect(plane.received.find((r) => r.url.endsWith("/result"))?.body).toMatchObject({
      status: "error",
      refusedModel: "sonnet",
    });
  });

  it("pauses claiming after the plan rate-limits a run, doubling while it keeps happening", async () => {
    const limited: ClaimedJob = {
      ...claimedJob,
      job: { ...claimedJob.job, id: "job-2", runId: "run-2" },
      pullRequest: { owner: "o", repo: "r", number: 8 },
    };
    const plane = await fakeControlPlane(scripted([claimedJob, limited, undefined]));
    servers.push(plane.server);
    const stop = new AbortController();
    const sleeps: number[] = [];
    const d = await deps(plane.baseUrl, {
      signal: stop.signal,
      harnessResult: {
        status: "error",
        turns: 0,
        error:
          'claude exited with 1: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length === 2) stop.abort();
      },
    });
    await runRunnerLoop(d);
    const waits = d.reported.flatMap((event) =>
      event.state === "waiting" && event.detail.includes("rate-limited") ? [event.detail] : [],
    );
    expect(waits).toEqual([
      "the plan rate-limited the run; claiming again in 1 min",
      "the plan rate-limited the run; claiming again in 2 min",
    ]);
    expect(sleeps[0]).toBeGreaterThan(59_000);
    expect(sleeps[0]).toBeLessThanOrEqual(60_000);
    expect(sleeps[1]).toBeGreaterThan(119_000);
    expect(sleeps[1]).toBeLessThanOrEqual(120_000);
    expect(plane.received.filter((r) => r.url.endsWith("/result"))).toHaveLength(2);
  });

  it("counts slots that hit the same limit together as one wall", async () => {
    const limited = (id: string, number: number): ClaimedJob =>
      pool({
        ...claimedJob,
        job: { ...claimedJob.job, id, runId: `run-${id}` },
        pullRequest: { owner: "o", repo: "r", number },
      });
    const plane = await fakeControlPlane(scripted([limited("job-1", 7), limited("job-2", 8)]));
    servers.push(plane.server);
    const stop = new AbortController();
    const sleeps: number[] = [];
    const { promise: bothStarted, open: release } = gate();
    let started = 0;
    const d = await deps(plane.baseUrl, {
      signal: stop.signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        stop.abort();
      },
    });
    d.harness = {
      name: "limited",
      run: async () => {
        started += 1;
        if (started === 2) release();
        await bothStarted;
        return { status: "error", turns: 0, error: "API Error: 529 overloaded_error" };
      },
    };
    await runRunnerLoop(d);
    const waits = d.reported.flatMap((event) =>
      event.state === "waiting" && event.detail.includes("overload") ? [event.detail] : [],
    );
    expect(waits).toEqual(["the plan is overloaded; claiming again in 1 min"]);
    expect(sleeps).toHaveLength(1);
  });

  it("starts the pause over after a run succeeds and stops doubling at sixteen minutes", async () => {
    const limitedError =
      'claude exited with 1: API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}';
    const claims = [1, 2, 3, 4, 5, 6, 7].map((number) => ({
      ...claimedJob,
      job: { ...claimedJob.job, id: `job-${number}`, runId: `run-${number}` },
      pullRequest: { owner: "o", repo: "r", number },
    }));
    const plane = await fakeControlPlane(scripted(claims));
    servers.push(plane.server);
    const stop = new AbortController();
    const sleeps: number[] = [];
    const d = await deps(plane.baseUrl, {
      signal: stop.signal,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length === 6) stop.abort();
      },
    });
    let runs = 0;
    d.harness = {
      name: "limited",
      run: async (i) => {
        runs += 1;
        if (runs === 2) {
          await writeFile(i.resultPath, JSON.stringify(review));
          return { status: "ok", turns: 1 };
        }
        return { status: "error", turns: 0, error: limitedError };
      },
    };
    await runRunnerLoop(d);
    const minutes = d.reported.flatMap((event) =>
      event.state === "waiting" && event.detail.includes("rate-limited")
        ? [Number(/in (\d+) min/.exec(event.detail)![1])]
        : [],
    );
    expect(minutes).toEqual([1, 1, 2, 4, 8, 16]);
  });

  it("runs the job on the harness its settings name and refuses one it does not have", async () => {
    const codexJob: ClaimedJob = {
      ...claimedJob,
      settings: { ...claimedJob.settings, harness: "codex" },
    };
    const unknownJob: ClaimedJob = {
      ...claimedJob,
      job: { ...claimedJob.job, id: "job-2", runId: "run-2" },
      settings: { ...claimedJob.settings, harness: "gemini" },
    };
    const plane = await fakeControlPlane(scripted([codexJob, unknownJob, undefined]));
    servers.push(plane.server);
    const stop = new AbortController();
    const codexRuns: number[] = [];
    const d = await deps(plane.baseUrl, {
      signal: stop.signal,
      sleep: async () => stop.abort(),
    });
    d.harnesses = {
      codex: {
        name: "codex",
        run: async (i) => {
          codexRuns.push(1);
          await writeFile(i.resultPath, JSON.stringify(review));
          return { status: "ok", turns: 1 };
        },
      },
    };
    await runRunnerLoop(d);
    expect(codexRuns).toHaveLength(1);
    expect(d.harness.run).not.toHaveBeenCalled();
    const results = plane.received.filter((r) => r.url.endsWith("/result")).map((r) => r.body);
    expect(results[0]).toMatchObject({ status: "ok" });
    expect(results[1]).toEqual({
      status: "error",
      turns: 0,
      error: "Harness gemini is not available on this runner; choose another in Settings.",
    });
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
  it("waits as long as the control plane says and reports idle once", async () => {
    const controller = new AbortController();
    const sleeps: number[] = [];
    const d = await deps("http://127.0.0.1:1", {
      signal: controller.signal,
      emptyPollDelayMs: 5,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length === 3) controller.abort();
      },
    });
    const answers = [{ retryAfterMs: 60_000 }, { retryAfterMs: 60_000 }, undefined];
    d.client = {
      claimJob: async () => answers.shift(),
      heartbeat: async () => ({ superseded: false }),
      sendEvents: async () => {},
      sendResult: async () => ({ ok: true }),
    };
    await runRunnerLoop(d);
    expect(sleeps).toEqual([60_000, 60_000, 5]);
    expect(d.reported.filter((event) => event.state === "idle")).toEqual([
      { state: "idle", detail: "no pull request has reviews on; asking again every 60s" },
    ]);
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

describe("sleptFor", () => {
  it("reports a tick that lands far later than scheduled and ignores ordinary jitter", () => {
    const interval = 15_000;
    expect(sleptFor(0, interval + 2_000, interval)).toBeUndefined();
    expect(sleptFor(0, interval + SLEEP_GAP_MS, interval)).toBeUndefined();
    expect(sleptFor(0, interval + SLEEP_GAP_MS + 1, interval)).toBe(interval + SLEEP_GAP_MS + 1);
    expect(sleptFor(1_000, 1_000 + 5 * 60_000, interval)).toBe(5 * 60_000);
  });
});

describe("watchClock", () => {
  it("says how long the machine slept when a tick lands late", () => {
    vi.useFakeTimers();
    try {
      const reported: RunnerEvent[] = [];
      const stop = watchClock((event) => reported.push(event), 15_000);
      vi.advanceTimersByTime(15_000);
      expect(reported).toEqual([]);
      vi.setSystemTime(Date.now() + 5 * 60_000);
      vi.advanceTimersByTime(15_000);
      expect(reported).toEqual([{ state: "waiting", detail: "the machine was asleep for 5 min" }]);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
