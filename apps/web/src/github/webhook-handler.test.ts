import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { createTestDb } from "../test/pglite";
import { handleWebhook } from "./webhook-handler";

const secret = "test-secret";
let db: Db;

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
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const rows = await db.select().from(schema.installation);
    expect(rows).toMatchObject([{ id: "7", accountLogin: "octo", accountType: "User" }]);
  });

  it("rejects a bad signature", async () => {
    const response = await handleWebhook(
      signedRequest("installation", createdPayload, "sha256=deadbeef"),
      { secret, db },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid signature" });
  });

  it("ignores events it does not handle", async () => {
    const response = await handleWebhook(signedRequest("ping", { zen: "hi" }), { secret, db });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ignored: "ping" });
  });

  it("rejects an installation payload missing required fields", async () => {
    const response = await handleWebhook(signedRequest("installation", { action: "created" }), {
      secret,
      db,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a request missing the event header", async () => {
    const request = signedRequest("installation", createdPayload);
    request.headers.delete("x-github-event");
    const response = await handleWebhook(request, { secret, db });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "missing event header" });
  });
});
