import type { GitHubClient, ReviewResult } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { enqueueJob } from "./jobs";
import { claimJob, heartbeat, recordEvents, recordResult } from "./runner-api";
import { createRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function createGitHub(): GitHubClient {
  return {
    installationTokenById: vi.fn(async () => "ghs_token"),
    installationToken: unsupported(),
    pullRequest: unsupported(),
    mergeBase: unsupported(),
    linkedIssue: unsupported(),
    reviews: unsupported(),
    postReview: unsupported(),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

const reviewResult: ReviewResult = {
  verdict: "ship",
  summary: "looks good",
  lenses: [],
  findings: [],
};

let db: Db;
let token: string;
let runnerId: string;
let github: GitHubClient;

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db, { armedPrId: "armed-1", userId: "user-1", repo: "a", number: 1 });
  const created = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
  token = created.token;
  runnerId = created.runner.id;
  github = createGitHub();
});

function request(path: string, init: RequestInit & { bearer?: string | null } = {}) {
  const { bearer, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (bearer !== null) headers.set("authorization", `Bearer ${bearer ?? token}`);
  return new Request(`https://hawkeye.test${path}`, { ...rest, headers });
}

function enqueue(notBefore = new Date(now.getTime() - 60_000)) {
  return enqueueJob(db, {
    armedPrId: "armed-1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    notBefore,
  });
}

const instantPoll = { intervalMs: 0, totalMs: 0 };

function claimDeps(overrides: Partial<Parameters<typeof claimJob>[1]> = {}) {
  return { db, github, now: () => now, poll: instantPoll, ...overrides };
}

describe("claimJob", () => {
  it("rejects a request without a token", async () => {
    const response = await claimJob(request("/api/runner/jobs", { bearer: null }), claimDeps());

    expect(response.status).toBe(401);
  });

  it("rejects a revoked token", async () => {
    await db.update(schema.runner).set({ revokedAt: now }).where(eq(schema.runner.id, runnerId));

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(401);
  });

  it("returns 204 when no job is ready", async () => {
    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(204);
  });

  it("claims a job, creates a run and mints an installation token", async () => {
    const queued = await enqueue();

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.job.id).toBe(queued.id);
    expect(body.job.headSha).toBe("a".repeat(40));
    expect(body.pullRequest).toEqual({ owner: "octo", repo: "a", number: 1 });
    expect(body.installationToken).toBe("ghs_token");
    expect(body.settings).toEqual({ maxTurns: 40, wallClockMinutes: 15 });
    expect(github.installationTokenById).toHaveBeenCalledWith("10");

    const [run] = await db.select().from(schema.run).where(eq(schema.run.id, body.job.runId));
    expect(run).toMatchObject({ jobId: queued.id, runnerId, status: "running" });
  });

  it("uses the user's settings when they exist", async () => {
    await enqueue();
    await db.insert(schema.userSettings).values({
      userId: "user-1",
      maxTurns: 7,
      wallClockMinutes: 3,
      promptOverride: "be brief",
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(await response.json()).toMatchObject({
      settings: { maxTurns: 7, wallClockMinutes: 3, promptOverride: "be brief" },
    });
  });

  it("does not claim another user's job", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "hubot", email: "h@example.com" })
      .onConflictDoNothing();
    await seedArmedPullRequest(db, {
      armedPrId: "armed-2",
      userId: "user-2",
      repo: "b",
      number: 2,
    });
    await enqueueJob(db, {
      armedPrId: "armed-2",
      headSha: "c".repeat(40),
      baseSha: "d".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(204);
  });

  it("requeues a stale job and claims it on the next poll", async () => {
    const queued = await enqueue();
    await db
      .update(schema.job)
      .set({
        state: "claimed",
        claimedByRunnerId: runnerId,
        claimedAt: new Date(now.getTime() - 3_600_000),
        heartbeatAt: new Date(now.getTime() - 3_600_000),
      })
      .where(eq(schema.job.id, queued.id));

    const sleep = vi.fn(async () => {});
    const response = await claimJob(
      request("/api/runner/jobs"),
      claimDeps({ poll: { intervalMs: 1, totalMs: 10 }, sleep }),
    );

    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((await response.json()).job.id).toBe(queued.id);
  });
});

describe("heartbeat", () => {
  it("stamps the heartbeat of a job the runner claimed", async () => {
    const queued = await enqueue();
    await claimJob(request("/api/runner/jobs"), claimDeps());

    const response = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );

    expect(response.status).toBe(200);
    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, queued.id));
    expect(row?.heartbeatAt?.getTime()).toBeGreaterThan(now.getTime());
  });

  it("404s for a job the runner does not hold", async () => {
    const queued = await enqueue();

    const response = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );

    expect(response.status).toBe(404);
  });

  it("401s without a token", async () => {
    const response = await heartbeat(
      request("/api/runner/jobs/x/heartbeat", { method: "POST", bearer: null }),
      { db },
      "x",
    );

    expect(response.status).toBe(401);
  });
});

async function claimedRunId() {
  await enqueue();
  const response = await claimJob(request("/api/runner/jobs"), claimDeps());
  return (await response.json()).job.runId as string;
}

function jsonRequest(path: string, body: unknown, bearer?: string | null) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...(bearer === null ? { bearer: null } : {}),
  });
}

describe("recordEvents", () => {
  it("bumps the run turns by the number of turn events", async () => {
    const runId = await claimedRunId();
    const events = [
      { type: "turn", at: now.toISOString() },
      { type: "tool", at: now.toISOString(), data: { name: "read" } },
      { type: "turn", at: now.toISOString() },
    ];

    const response = await recordEvents(
      jsonRequest(`/api/runner/runs/${runId}/events`, events),
      { db },
      runId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, turns: 2 });
  });

  it("rejects a payload that is not an array of events", async () => {
    const runId = await claimedRunId();

    const response = await recordEvents(
      jsonRequest(`/api/runner/runs/${runId}/events`, { type: "turn" }),
      { db },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("rejects an event without a type", async () => {
    const runId = await claimedRunId();

    const response = await recordEvents(
      jsonRequest(`/api/runner/runs/${runId}/events`, [{ at: now.toISOString() }]),
      { db },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("404s for a run the runner does not own", async () => {
    const response = await recordEvents(
      jsonRequest("/api/runner/runs/missing/events", []),
      { db },
      "missing",
    );

    expect(response.status).toBe(404);
  });
});

describe("recordResult", () => {
  it("stores the result and completes the run and the job", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 12,
        result: reviewResult,
      }),
      { db },
      runId,
    );

    expect(response.status).toBe(200);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "ok", turns: 12, result: reviewResult });
    expect(row?.endedAt).not.toBeNull();
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, row!.jobId));
    expect(jobRow?.state).toBe("done");
  });

  it("fails the job for a non-ok status", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "timeout",
        turns: 3,
        error: "wall clock",
      }),
      { db },
      runId,
    );

    expect(response.status).toBe(200);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "timeout", error: "wall clock" });
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, row!.jobId));
    expect(jobRow?.state).toBe("failed");
  });

  it("rejects an unknown status", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "weird", turns: 1 }),
      { db },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-integer turns", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "error", turns: 1.5 }),
      { db },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("rejects an ok result without a review result", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "ok", turns: 1 }),
      { db },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("409s when the run is already complete", async () => {
    const runId = await claimedRunId();
    const body = { status: "error", turns: 1, error: "boom" };
    await recordResult(jsonRequest(`/api/runner/runs/${runId}/result`, body), { db }, runId);

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, body),
      { db },
      runId,
    );

    expect(response.status).toBe(409);
  });

  it("404s for a run the runner does not own", async () => {
    const response = await recordResult(
      jsonRequest("/api/runner/runs/missing/result", { status: "error", turns: 0 }),
      { db },
      "missing",
    );

    expect(response.status).toBe(404);
  });
});
