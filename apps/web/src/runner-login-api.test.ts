import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { approveRunnerLogin, RUNNER_LOGIN_TTL_MS } from "./runner-login";
import { collectLogin, startLogin } from "./runner-login-api";
import { createTestDb } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");
const siteUrl = "https://hawkeye.example";

let db: Db;

function deps(at = now) {
  return { db, siteUrl, now: () => at };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/runner/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values({ id: "user-1", name: "octocat", email: "o@example.com" });
});

describe("startLogin", () => {
  it("starts a login and returns the code, secret and verify url", async () => {
    const response = await startLogin(post({ name: "laptop" }), deps());

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
      deviceSecret: expect.stringMatching(/^hkd_/),
      expiresAt: new Date(now.getTime() + RUNNER_LOGIN_TTL_MS).toISOString(),
      intervalSeconds: 5,
    });
    expect(body.verifyUrl).toBe(`${siteUrl}/connect?code=${body.code}`);
  });

  it("rejects a bad name", async () => {
    for (const body of [{}, { name: " " }, { name: 7 }, { name: "x".repeat(65) }, "laptop"]) {
      const response = await startLogin(post(body), deps());
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
  });
});

describe("collectLogin", () => {
  it("reports pending, then approved once, then expired", async () => {
    const { code, deviceSecret } = await (
      await startLogin(post({ name: "laptop" }), deps())
    ).json();

    const pending = await collectLogin(deps(), deviceSecret);
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });

    await approveRunnerLogin(db, { userId: "user-1", code, now });
    const approved = await collectLogin(deps(), deviceSecret);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({
      status: "approved",
      token: expect.stringMatching(/^hk_/),
    });

    const again = await collectLogin(deps(), deviceSecret);
    expect(again.status).toBe(410);
    expect(await again.json()).toEqual({ status: "expired" });
  });

  it("expires an unknown secret and a stale login", async () => {
    const { deviceSecret } = await (await startLogin(post({ name: "laptop" }), deps())).json();

    expect((await collectLogin(deps(), "hkd_nope")).status).toBe(410);
    const stale = await collectLogin(
      deps(new Date(now.getTime() + RUNNER_LOGIN_TTL_MS)),
      deviceSecret,
    );
    expect(stale.status).toBe(410);
  });
});
