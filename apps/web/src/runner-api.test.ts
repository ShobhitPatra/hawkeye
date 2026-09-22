import { findingId, type GitHubClient, type ReviewResult } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { claimJob, heartbeat, recordEvents, recordResult } from "./runner-api";
import { createRunnerToken } from "./runner-tokens";
import { sweep } from "./sweep";
import { createTestDb, seedArmedPullRequest, queueJob } from "./test/pglite";

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
    reviews: vi.fn(async () => []),
    postReview: vi.fn(async () => ({
      url: "https://github.com/octo/a/pull/1#pullrequestreview-9",
      id: "9",
    })),
    updateReview: vi.fn(async () => {}),
    review: vi.fn(async () => ({ body: "" })),
    createCommitStatus: vi.fn(async () => {}),
    listInstallationRepositories: unsupported(),
    listUserInstallations: unsupported(),
    botLogin: vi.fn(async () => "hawkeye-review[bot]"),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

const reviewResult: ReviewResult = {
  verdict: "ship",
  summary: "looks good",
  lenses: [
    { name: "intent", assessment: "clear" },
    { name: "behavior", assessment: "clear" },
    { name: "blast_radius", assessment: "clear" },
    { name: "verification", assessment: "clear" },
    { name: "fit", assessment: "clear" },
    { name: "hygiene", assessment: "clear" },
  ],
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
  return queueJob(db, {
    headCurrentAt: new Date(),
    armedPrId: "armed-1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    notBefore,
  });
}

const instantPoll = { intervalMs: 0, totalMs: 0 };

function claimDeps(overrides: Partial<Parameters<typeof claimJob>[1]> = {}) {
  return {
    db,
    github,
    now: () => now,
    poll: instantPoll,
    controlPlaneUrl: "https://hawkeye.test",
    ...overrides,
  };
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
    expect(response.headers.get("retry-after")).toBeNull();
  });

  it("answers an idle user at once with how long to wait", async () => {
    await db.update(schema.armedPr).set({ disarmedAt: now });
    const sleep = vi.fn(async () => {});

    const response = await claimJob(
      request("/api/runner/jobs", { headers: { "X-Hawkeye-Honors-Retry-After": "1" } }),
      claimDeps({ poll: { intervalMs: 1, totalMs: 10 }, sleep }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("holds an idle user's claim as before for a daemon that does not read the wait", async () => {
    await db.update(schema.armedPr).set({ disarmedAt: now });
    let clock = now.getTime();
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });

    const response = await claimJob(
      request("/api/runner/jobs"),
      claimDeps({ poll: { intervalMs: 1, totalMs: 3 }, sleep, now: () => new Date(clock) }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(sleep).toHaveBeenCalled();
  });

  it("holds the claim as before once the user has reviews on, and claims a queued job", async () => {
    let clock = now.getTime();
    const sleep = vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    });
    const held = await claimJob(
      request("/api/runner/jobs"),
      claimDeps({ poll: { intervalMs: 1, totalMs: 3 }, sleep, now: () => new Date(clock) }),
    );
    expect(held.status).toBe(204);
    expect(held.headers.get("retry-after")).toBeNull();
    expect(sleep).toHaveBeenCalled();

    await enqueue();
    const claimed = await claimJob(request("/api/runner/jobs"), claimDeps());
    expect(claimed.status).toBe(200);
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
    expect(body.settings).toEqual({
      maxTurns: 40,
      wallClockMinutes: 15,
      harness: "claude-code",
      concurrency: 1,
    });
    expect(github.installationTokenById).toHaveBeenCalledWith("10");
    expect(github.createCommitStatus).toHaveBeenCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "a".repeat(40),
      { state: "pending", description: "Reviewing on laptop", context: "hawkeye" },
      "ghs_token",
    );

    const [run] = await db.select().from(schema.run).where(eq(schema.run.id, body.job.runId));
    expect(run).toMatchObject({ jobId: queued.id, runnerId, status: "running" });
  });

  it("posts a reviewing placeholder at claim time when nothing is posted yet", async () => {
    await enqueue();
    const response = await claimJob(request("/api/runner/jobs"), claimDeps());
    const body = await response.json();
    const [reference, review] = (github.postReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(reference).toEqual({ owner: "octo", repo: "a", number: 1 });
    expect(review.comments).toEqual([]);
    expect(review.body).toContain(
      "![Reviewing on laptop](https://hawkeye.test/status/reviewing?runner=laptop)",
    );
    expect(review.body).toContain("This comment is replaced when the review lands.");
    const [run] = await db.select().from(schema.run).where(eq(schema.run.id, body.job.runId));
    expect(run?.placeholderReviewId).toBe("9");
  });

  it("prepends the reviewing line to the living review on a later claim", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      firstRunId,
    );
    github.review = vi.fn(async () => ({ body: "<!-- hawkeye: head=aaa -->\n\n### Ship\n" }));
    (github.updateReview as ReturnType<typeof vi.fn>).mockClear();
    (github.postReview as ReturnType<typeof vi.fn>).mockClear();
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "b".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(github.postReview).not.toHaveBeenCalled();
    const [, reviewId, body] = (github.updateReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(reviewId).toBe("9");
    expect(body.startsWith("<!-- hawkeye: reviewing -->")).toBe(true);
    expect(body).toContain("Reviewing on laptop");
    expect(body.endsWith("<!-- hawkeye: head=aaa -->\n\n### Ship\n")).toBe(true);
  });

  it("reuses the closed placeholder on the next claim after a failed round", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "error",
        turns: 1,
        error: "boom",
      }),
      { db, github },
      firstRunId,
    );
    (github.updateReview as ReturnType<typeof vi.fn>).mockClear();
    (github.postReview as ReturnType<typeof vi.fn>).mockClear();
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "b".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());
    const body = await response.json();

    expect(github.postReview).not.toHaveBeenCalled();
    const [, reviewId, reviewBody] = (github.updateReview as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(reviewId).toBe("9");
    expect(reviewBody).toContain("Reviewing on laptop");
    const [run] = await db.select().from(schema.run).where(eq(schema.run.id, body.job.runId));
    expect(run?.placeholderReviewId).toBe("9");
  });

  it("still claims when the commit status cannot be set", async () => {
    await enqueue();
    github.createCommitStatus = vi.fn(async () => {
      throw new Error("Resource not accessible by integration");
    });
    const log = vi.fn();

    const response = await claimJob(request("/api/runner/jobs"), { ...claimDeps(), log });

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("commit status not set"));
  });

  it("releases the job when the installation token cannot be minted", async () => {
    const queued = await enqueue();
    github.installationTokenById = vi.fn(async () => {
      throw new Error("github is down");
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(500);

    const [job] = await db.select().from(schema.job).where(eq(schema.job.id, queued.id));
    expect(job).toMatchObject({
      state: "queued",
      claimedByRunnerId: null,
      claimedAt: null,
      heartbeatAt: null,
    });
    const [run] = await db.select().from(schema.run).where(eq(schema.run.jobId, queued.id));
    expect(run).toMatchObject({ status: "error", error: "installation token" });
  });

  it("uses the user's settings when they exist", async () => {
    await enqueue();
    await db.insert(schema.userSettings).values({
      userId: "user-1",
      maxTurns: 7,
      wallClockMinutes: 3,
      promptOverride: "be brief",
      model: "claude-opus-5",
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(await response.json()).toMatchObject({
      settings: {
        maxTurns: 7,
        wallClockMinutes: 3,
        promptOverride: "be brief",
        model: "claude-opus-5",
        harness: "claude-code",
        concurrency: 1,
      },
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
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "c".repeat(40),
      baseSha: "d".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect(response.status).toBe(204);
  });

  it("returns the previous round once an ok run has a posted review", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          verdict: "changes_needed",
          findings: [
            {
              path: "a.txt",
              line: 2,
              severity: "should_fix",
              claim: "Leaks a handle",
              detail: "Close it.",
            },
          ],
        },
      }),
      { db, github },
      firstRunId,
    );
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect((await response.json()).previousRound).toEqual({
      headSha: "a".repeat(40),
      findings: [
        {
          id: findingId("a.txt", "Leaks a handle"),
          severity: "should_fix",
          claim: "Leaks a handle",
          detail: "Close it.",
          path: "a.txt",
          line: 2,
        },
      ],
    });
  });

  it("returns the pull request's last posted round to a sibling arm", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          findings: [{ severity: "should_fix", claim: "Leaks a handle", detail: "Close it." }],
        },
      }),
      { db, github },
      firstRunId,
    );
    await db.insert(schema.user).values({ id: "user-2", name: "other", email: "x@example.com" });
    const [sibling] = await db
      .insert(schema.armedPr)
      .values({ userId: "user-2", installationId: "10", owner: "octo", repo: "a", number: 1 })
      .returning();
    const other = await createRunnerToken(db, { userId: "user-2", name: "desk" });
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: sibling!.id,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });

    const response = await claimJob(
      request("/api/runner/jobs", { bearer: other.token }),
      claimDeps(),
    );

    expect((await response.json()).previousRound).toEqual({
      headSha: "a".repeat(40),
      findings: [
        {
          id: findingId(undefined, "Leaks a handle"),
          severity: "should_fix",
          claim: "Leaks a handle",
          detail: "Close it.",
        },
      ],
    });
  });

  it("returns no previous round when no review was posted", async () => {
    const firstRunId = await claimedRunId();
    github.updateReview = vi.fn(async () => {
      throw new Error("GitHub PUT failed: 500");
    });
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      firstRunId,
    );
    await enqueue();

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect((await response.json()).previousRound).toBeUndefined();
  });

  it("appends the arm's still-open findings from earlier rounds", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          verdict: "changes_needed",
          findings: [
            {
              path: "a.txt",
              line: 2,
              severity: "should_fix",
              claim: "Leaks a handle",
              detail: "Close it.",
            },
          ],
        },
      }),
      { db, github },
      firstRunId,
    );
    await db.insert(schema.finding).values({
      armedPrId: "armed-1",
      stableId: findingId("b.txt", "Missing tests"),
      severity: "optional",
      claim: "Missing tests",
      path: "b.txt",
      line: 5,
      firstSeenSha: "9".repeat(40),
    });
    await db.insert(schema.finding).values({
      armedPrId: "armed-1",
      stableId: findingId("c.txt", "No docs"),
      severity: "optional",
      claim: "No docs",
      detail: "Document the flag.",
      path: "c.txt",
      line: 1,
      firstSeenSha: "9".repeat(40),
    });
    await enqueue();

    const response = await claimJob(request("/api/runner/jobs"), claimDeps());

    expect((await response.json()).previousRound.findings).toEqual([
      {
        id: findingId("a.txt", "Leaks a handle"),
        severity: "should_fix",
        claim: "Leaks a handle",
        detail: "Close it.",
        path: "a.txt",
        line: 2,
      },
      {
        id: findingId("b.txt", "Missing tests"),
        severity: "optional",
        claim: "Missing tests",
        detail: "Missing tests",
        path: "b.txt",
        line: 5,
      },
      {
        id: findingId("c.txt", "No docs"),
        severity: "optional",
        claim: "No docs",
        detail: "Document the flag.",
        path: "c.txt",
        line: 1,
      },
    ]);
  });

  it("leaves a stale claim alone until the scheduled sweep requeues it, then claims it", async () => {
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

    const before = await claimJob(request("/api/runner/jobs"), claimDeps());
    expect(before.status).toBe(204);

    const swept = await sweep(
      new Request("https://hawkeye.test/api/internal/sweep", {
        method: "POST",
        headers: { authorization: "Bearer s3cret" },
      }),
      { db, github, secret: "s3cret", now: () => now },
    );
    expect(await swept.json()).toEqual({ ok: true, swept: 1 });

    const after = await claimJob(request("/api/runner/jobs"), claimDeps());
    expect(after.status).toBe(200);
    expect((await after.json()).job.id).toBe(queued.id);
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

  it("says the job is superseded once a newer job exists for the arm", async () => {
    const queued = await enqueue();
    await claimJob(request("/api/runner/jobs"), claimDeps());
    const first = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );
    expect(await first.json()).toEqual({ ok: true, superseded: false });

    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: now,
    });
    const second = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );
    expect(await second.json()).toEqual({ ok: true, superseded: true });
  });

  it("does not count a newer job for the same head as superseding", async () => {
    const queued = await enqueue();
    await claimJob(request("/api/runner/jobs"), claimDeps());
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: queued.headSha,
      baseSha: "b".repeat(40),
      notBefore: now,
    });
    const response = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );
    expect(await response.json()).toEqual({ ok: true, superseded: false });
  });

  it("409s for a job the runner does not hold", async () => {
    const queued = await enqueue();

    const response = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "job is no longer claimed by this runner",
    });
  });

  it("409s once another runner has taken the claim over", async () => {
    const queued = await enqueue();
    await claimJob(request("/api/runner/jobs"), claimDeps());
    const other = await createRunnerToken(db, { userId: "user-1", name: "desktop" });
    await db
      .update(schema.job)
      .set({ claimedByRunnerId: other.runner.id })
      .where(eq(schema.job.id, queued.id));

    const response = await heartbeat(
      request(`/api/runner/jobs/${queued.id}/heartbeat`, { method: "POST" }),
      { db },
      queued.id,
    );

    expect(response.status).toBe(409);
  });

  it("404s for a job that does not exist", async () => {
    const response = await heartbeat(
      request("/api/runner/jobs/missing/heartbeat", { method: "POST" }),
      { db },
      "missing",
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
    ...(bearer === undefined ? {} : { bearer }),
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

  it("409s once the job is no longer claimed by this runner", async () => {
    const runId = await claimedRunId();
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    await db
      .update(schema.job)
      .set({ state: "queued", claimedByRunnerId: null })
      .where(eq(schema.job.id, row!.jobId));

    const response = await recordEvents(
      jsonRequest(`/api/runner/runs/${runId}/events`, [{ type: "turn", at: now.toISOString() }]),
      { db },
      runId,
    );

    expect(response.status).toBe(409);
    const [after] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(after?.turns).toBe(0);
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
      { db, github },
      runId,
    );

    expect(response.status).toBe(200);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "ok", turns: 12, result: reviewResult });
    expect(row?.endedAt).not.toBeNull();
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, row!.jobId));
    expect(jobRow?.state).toBe("done");
  });

  it("posts the rendered review for an ok result and records it", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
        commentable: { "a.txt": [1, 2] },
      }),
      { db, github },
      runId,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "posted",
      findings: { created: 0, updated: 0, resolved: 0 },
    });
    expect(github.installationTokenById).toHaveBeenCalledWith("10");
    const [, placeholder] = (github.postReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(placeholder.body).toContain("Reviewing on laptop");
    const [reference, reviewId, body, usedToken] = (github.updateReview as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(reference).toEqual({ owner: "octo", repo: "a", number: 1 });
    expect(reviewId).toBe("9");
    expect(usedToken).toBe("ghs_token");
    expect(body).toContain(`<!-- hawkeye: head=${"a".repeat(40)} -->`);
    expect(body).not.toContain("hawkeye: reviewing");
    expect(github.createCommitStatus).toHaveBeenLastCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "a".repeat(40),
      { state: "success", description: "Ship · 0 findings", context: "hawkeye" },
      "ghs_token",
    );
    expect(body.trimEnd().endsWith("on the author's own plan · round 1 · 1 turn")).toBe(true);
    const [row] = await db.select().from(schema.reviewPosted);
    expect(row).toMatchObject({
      runId,
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      githubReviewId: "9",
    });
  });

  it("stores the refused model and names it in the review's footer", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 3,
        result: reviewResult,
        refusedModel: "claude-fable-5-1",
      }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(200);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "ok", refusedModel: "claude-fable-5-1" });
    const [, , body] = (github.updateReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(body).toContain("reviewed on the default model because claude-fable-5-1 was refused");
  });

  it("rejects an empty refused model", async () => {
    const runId = await claimedRunId();
    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 3,
        result: reviewResult,
        refusedModel: "",
      }),
      { db, github },
      runId,
    );
    expect(response.status).toBe(400);
  });

  it("records the findings of an ok result and reports the counts", async () => {
    const withFindings: ReviewResult = {
      ...reviewResult,
      verdict: "changes_needed",
      findings: [
        { path: "a.txt", line: 2, severity: "should_fix", claim: "Leaks a handle", detail: "d" },
        { severity: "must_fix", claim: "Missing tests", detail: "d" },
      ],
    };
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: withFindings,
      }),
      { db, github },
      runId,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "posted",
      findings: { created: 2, updated: 0, resolved: 0 },
    });
    const rows = await db.select().from(schema.finding);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.path === "a.txt")).toMatchObject({
      armedPrId: "armed-1",
      stableId: findingId("a.txt", "Leaks a handle"),
      severity: "should_fix",
      line: 2,
      firstSeenSha: "a".repeat(40),
      resolvedSha: null,
    });
  });

  it("resolves findings the result reports addressed even when repeated", async () => {
    const leak = {
      path: "a.txt",
      line: 2,
      severity: "should_fix",
      claim: "Leaks a handle",
      detail: "Close it.",
    };
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: { ...reviewResult, verdict: "changes_needed", findings: [leak] },
      }),
      { db, github },
      firstRunId,
    );
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });
    const claim = await claimJob(request("/api/runner/jobs"), claimDeps());
    const secondRunId = (await claim.json()).job.runId as string;
    github.updateReview = vi.fn(async () => {});

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${secondRunId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          verdict: "changes_needed",
          findings: [leak],
          priorFindings: [
            { id: findingId("a.txt", "Leaks a handle"), status: "addressed", note: "closed" },
          ],
        },
      }),
      { db, github },
      secondRunId,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "posted",
      findings: { created: 0, updated: 1, resolved: 1 },
    });
    expect(github.updateReview).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(schema.finding);
    expect(row?.resolvedSha).toBe("c".repeat(40));
    expect(row?.detail).toBe("Close it.");
  });

  it("does not post twice for the same head", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      firstRunId,
    );
    const secondRunId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${secondRunId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      secondRunId,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "already-posted",
      findings: "already-posted",
    });
    expect(github.postReview).toHaveBeenCalledTimes(1);
    expect(await db.select().from(schema.reviewPosted)).toHaveLength(1);
  });

  it("keeps the ok result and records the failure when posting throws", async () => {
    const runId = await claimedRunId();
    github.updateReview = vi.fn(async () => {
      throw new Error("GitHub POST failed: 500");
    });

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          findings: [{ severity: "should_fix", claim: "kept", detail: "d", path: "a.ts", line: 1 }],
        },
      }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      posted: "failed",
      findings: { created: 1, updated: 0, resolved: 0 },
    });
    expect(await db.select().from(schema.finding)).toHaveLength(1);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "ok", error: "post: GitHub POST failed: 500" });
    expect(await db.select().from(schema.reviewPosted)).toHaveLength(0);
  });

  it("reports failed findings and keeps the posted review when recording throws", async () => {
    const runId = await claimedRunId();
    const log = vi.fn();
    let transactions = 0;
    const broken = Object.create(db, {
      transaction: {
        value: (...args: Parameters<typeof db.transaction>) => {
          transactions += 1;
          if (transactions > 2) throw new Error("db gone");
          return db.transaction(...args);
        },
      },
    }) as typeof db;

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db: broken, github, log },
      runId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, posted: "posted", findings: "failed" });
    expect(log).toHaveBeenCalledWith(`findings not recorded for run ${runId}: db gone`);
  });

  it("leaves the rows alone when the head was already posted", async () => {
    const first = await claimedRunId();
    const withFinding = {
      ...reviewResult,
      findings: [{ severity: "should_fix", claim: "first", detail: "d", path: "a.ts", line: 1 }],
    };
    await recordResult(
      jsonRequest(`/api/runner/runs/${first}/result`, {
        status: "ok",
        turns: 1,
        result: withFinding,
      }),
      { db, github },
      first,
    );
    const second = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${second}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      second,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "already-posted",
      findings: "already-posted",
    });
    const stored = await db.select().from(schema.finding);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.resolvedSha).toBeNull();
  });

  it("records findings for a second user armed on a pull request another user already posted", async () => {
    const first = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${first}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      first,
    );
    await db.insert(schema.user).values({ id: "user-2", name: "other", email: "x@example.com" });
    await seedArmedPullRequest(db, {
      armedPrId: "armed-2",
      userId: "user-2",
      repo: "a",
      number: 1,
    });
    const other = await createRunnerToken(db, { userId: "user-2", name: "desk" });
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(now.getTime() - 60_000),
    });
    const claim = await claimJob(request("/api/runner/jobs", { bearer: other.token }), claimDeps());
    const second = (await claim.json()).job.runId as string;

    const response = await recordResult(
      jsonRequest(
        `/api/runner/runs/${second}/result`,
        {
          status: "ok",
          turns: 1,
          result: {
            ...reviewResult,
            findings: [
              { severity: "should_fix", claim: "theirs", detail: "d", path: "a.ts", line: 1 },
            ],
          },
        },
        other.token,
      ),
      { db, github },
      second,
    );

    expect(await response.json()).toEqual({
      ok: true,
      posted: "already-posted",
      findings: { created: 1, updated: 0, resolved: 0 },
    });
  });

  it("does not record findings from a result whose head a newer done job superseded", async () => {
    const runId = await claimedRunId();
    const newer = await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: now,
    });
    await db.update(schema.job).set({ state: "done" }).where(eq(schema.job.id, newer.id));

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: {
          ...reviewResult,
          findings: [{ severity: "should_fix", claim: "old", detail: "d", path: "a.ts", line: 1 }],
        },
      }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      posted: "superseded",
      findings: "superseded",
    });
    expect(github.createCommitStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(String),
      { state: "success", description: "Superseded by a newer push", context: "hawkeye" },
      "ghs_token",
    );
    expect(await db.select().from(schema.finding)).toHaveLength(0);
  });

  it("rejects malformed commentable lines", async () => {
    const runId = await claimedRunId();
    (github.postReview as ReturnType<typeof vi.fn>).mockClear();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
        commentable: { "a.txt": [1, -2] },
      }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("commentable");
    expect(github.postReview).not.toHaveBeenCalled();
  });

  it("closes a superseded run with the superseded sentences", async () => {
    const runId = await claimedRunId();
    (github.postReview as ReturnType<typeof vi.fn>).mockClear();

    await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "superseded", turns: 2 }),
      { db, github },
      runId,
    );

    expect(github.postReview).not.toHaveBeenCalled();
    expect(github.createCommitStatus).toHaveBeenCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "a".repeat(40),
      { state: "success", description: "Superseded by a newer push", context: "hawkeye" },
      "ghs_token",
    );
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row?.status).toBe("superseded");
  });

  it("leaves the living review's reviewing block to a newer run that is live", async () => {
    const firstRunId = await claimedRunId();
    await recordResult(
      jsonRequest(`/api/runner/runs/${firstRunId}/result`, {
        status: "ok",
        turns: 1,
        result: reviewResult,
      }),
      { db, github },
      firstRunId,
    );
    const queue = (headSha: string) =>
      queueJob(db, {
        headCurrentAt: new Date(),
        armedPrId: "armed-1",
        headSha,
        baseSha: "b".repeat(40),
        notBefore: new Date(now.getTime() - 60_000),
      });
    await queue("b".repeat(40));
    const older = await (await claimJob(request("/api/runner/jobs"), claimDeps())).json();
    await queue("c".repeat(40));
    await claimJob(request("/api/runner/jobs"), claimDeps());
    (github.updateReview as ReturnType<typeof vi.fn>).mockClear();
    (github.review as ReturnType<typeof vi.fn>).mockClear();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${older.job.runId}/result`, { status: "superseded", turns: 2 }),
      { db, github },
      older.job.runId,
    );

    expect(response.status).toBe(200);
    expect(github.review).not.toHaveBeenCalled();
    expect(github.updateReview).not.toHaveBeenCalled();
    expect(github.createCommitStatus).toHaveBeenCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "b".repeat(40),
      { state: "success", description: "Superseded by a newer push", context: "hawkeye" },
      "ghs_token",
    );
  });

  it("still closes the older run's own placeholder when a newer run is live", async () => {
    const olderRunId = await claimedRunId();
    await queueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: now,
    });
    await claimJob(request("/api/runner/jobs"), claimDeps());
    (github.updateReview as ReturnType<typeof vi.fn>).mockClear();

    await recordResult(
      jsonRequest(`/api/runner/runs/${olderRunId}/result`, { status: "superseded", turns: 2 }),
      { db, github },
      olderRunId,
    );

    expect(github.updateReview).toHaveBeenCalledTimes(1);
    const [, reviewId, body] = (github.updateReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(reviewId).toBe("9");
    expect(body).toBe("Superseded by a newer push; its review follows.");
  });

  it("does not post for a non-ok status", async () => {
    const runId = await claimedRunId();
    (github.postReview as ReturnType<typeof vi.fn>).mockClear();

    await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "error",
        turns: 1,
        error: "boom",
      }),
      { db, github },
      runId,
    );

    expect(github.postReview).not.toHaveBeenCalled();
    expect(await db.select().from(schema.reviewPosted)).toHaveLength(0);
    expect(github.createCommitStatus).toHaveBeenCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "a".repeat(40),
      { state: "success", description: "Review did not complete", context: "hawkeye" },
      "ghs_token",
    );
    expect(github.updateReview).toHaveBeenCalledWith(
      { owner: "octo", repo: "a", number: 1 },
      "9",
      "The review did not complete. The next push queues a new one.",
      "ghs_token",
    );
  });

  it("fails the job for a non-ok status", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "timeout",
        turns: 3,
        error: "wall clock",
      }),
      { db, github },
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
      { db, github },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("rejects non-integer turns", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "error", turns: 1.5 }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("rejects an ok result without a review result", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, { status: "ok", turns: 1 }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(400);
  });

  it("409s when the run is already complete", async () => {
    const runId = await claimedRunId();
    const body = { status: "error", turns: 1, error: "boom" };
    await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, body),
      { db, github },
      runId,
    );

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, body),
      { db, github },
      runId,
    );

    expect(response.status).toBe(409);
  });

  it("404s for a run the runner does not own", async () => {
    const response = await recordResult(
      jsonRequest("/api/runner/runs/missing/result", { status: "error", turns: 0 }),
      { db, github },
      "missing",
    );

    expect(response.status).toBe(404);
  });

  it("rejects a malformed review result and stores nothing", async () => {
    const runId = await claimedRunId();

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${runId}/result`, {
        status: "ok",
        turns: 2,
        result: { verdict: "maybe", summary: "", lenses: [], findings: [] },
      }),
      { db, github },
      runId,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Invalid review result");
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "running", result: null, turns: 0, endedAt: null });
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, row!.jobId));
    expect(jobRow?.state).toBe("claimed");
  });

  it("409s on a late result once the job was requeued and reclaimed", async () => {
    const queued = await enqueue();
    const first = await claimJob(request("/api/runner/jobs"), claimDeps());
    const staleRunId = (await first.json()).job.runId as string;
    await db
      .update(schema.job)
      .set({ heartbeatAt: new Date(now.getTime() - 3_600_000) })
      .where(eq(schema.job.id, queued.id));

    await sweep(
      new Request("https://hawkeye.test/api/internal/sweep", {
        method: "POST",
        headers: { authorization: "Bearer s3cret" },
      }),
      { db, github, secret: "s3cret", now: () => now },
    );
    const other = await createRunnerToken(db, { userId: "user-1", name: "desktop" });
    const second = await claimJob(
      request("/api/runner/jobs", { bearer: other.token }),
      claimDeps(),
    );
    expect(second.status).toBe(200);
    const freshRunId = (await second.json()).job.runId as string;

    const response = await recordResult(
      jsonRequest(`/api/runner/runs/${staleRunId}/result`, {
        status: "ok",
        turns: 5,
        result: reviewResult,
      }),
      { db, github },
      staleRunId,
    );

    expect(response.status).toBe(409);
    const [fresh] = await db.select().from(schema.run).where(eq(schema.run.id, freshRunId));
    expect(fresh).toMatchObject({
      status: "running",
      runnerId: other.runner.id,
      result: null,
      endedAt: null,
    });
    const [jobRow] = await db.select().from(schema.job).where(eq(schema.job.id, queued.id));
    expect(jobRow).toMatchObject({ state: "claimed", claimedByRunnerId: other.runner.id });
  });
});
