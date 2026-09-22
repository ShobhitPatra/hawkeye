import { createHmac } from "node:crypto";
import type { GitHubClient } from "@hawkeye/core";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { createTestDb, seedArmedPullRequest } from "../test/pglite";
import { handleWebhook } from "./webhook-handler";

const secret = "test-secret";
let db: Db;

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

const github: GitHubClient = {
  mergeBase: vi.fn(async () => "m".repeat(40)),
  installationTokenById: vi.fn(async () => "ghs_t"),
  installationToken: unsupported(),
  pullRequest: vi.fn(async () => ({
    number: 42,
    title: "title",
    body: "",
    author: "octocat",
    draft: false,
    headSha: "h".repeat(40),
    headRef: "feature",
    baseSha: "b".repeat(40),
    baseRef: "main",
    cloneUrl: "https://github.com/octo/repo.git",
    commits: 1,
  })),
  linkedIssue: unsupported(),
  reviews: unsupported(),
  postReview: unsupported(),
  updateReview: unsupported(),
  review: unsupported(),
  createCommitStatus: unsupported(),
  listInstallationRepositories: unsupported(),
  listUserInstallations: unsupported(),
  botLogin: unsupported(),
  listOpenPullRequestsByAuthor: unsupported(),
};

beforeAll(async () => {
  db = await createTestDb();
});

function signedRequest(eventName: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return new Request("https://hawkeye.test/api/github/webhook", {
    method: "POST",
    headers: {
      "x-github-event": eventName,
      "x-hub-signature-256":
        signature ?? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    },
    body,
  });
}

const createdPayload = {
  action: "created",
  installation: { id: 7, account: { login: "octo", type: "User" } },
  sender: { id: 1, login: "octocat" },
};

describe("handleWebhook", () => {
  it("records an installation for a validly signed event", async () => {
    const response = await handleWebhook(signedRequest("installation", createdPayload), {
      secret,
      db,
      github,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const rows = await db.select().from(schema.installation);
    expect(rows).toMatchObject([{ id: "7", accountLogin: "octo", accountType: "User" }]);
  });

  it("rejects a bad signature", async () => {
    const response = await handleWebhook(
      signedRequest("installation", createdPayload, "sha256=deadbeef"),
      { secret, db, github },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid signature" });
  });

  it("ignores events it does not handle", async () => {
    const response = await handleWebhook(signedRequest("ping", { zen: "hi" }), {
      secret,
      db,
      github,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ignored: "ping" });
  });

  it("rejects an installation payload missing required fields", async () => {
    const response = await handleWebhook(signedRequest("installation", { action: "created" }), {
      secret,
      db,
      github,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request missing the event header", async () => {
    const request = signedRequest("installation", createdPayload);
    request.headers.delete("x-github-event");
    const response = await handleWebhook(request, { secret, db, github });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "missing event header" });
  });

  it("queues a job for a pull_request synchronize event", async () => {
    const armed = await seedArmedPullRequest(db, { armedPrId: "armed-hook", number: 42 });
    const response = await handleWebhook(
      signedRequest("pull_request", {
        action: "synchronize",
        installation: { id: 10 },
        repository: { name: armed.repo, owner: { login: armed.owner } },
        pull_request: {
          number: armed.number,
          draft: false,
          merged: false,
          head: { sha: "h".repeat(40) },
          base: { sha: "b".repeat(40) },
          updated_at: "2026-01-01T00:00:00Z",
          user: { id: 501 },
        },
      }),
      { secret, db, github },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      armed: 0,
      enqueued: 1,
      disarmed: 0,
      cancelled: 0,
    });
  });
});
