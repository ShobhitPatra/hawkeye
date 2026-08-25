import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import {
  approveRunnerLogin,
  collectRunnerLogin,
  findRunnerLogin,
  formatRunnerLoginCode,
  normalizeRunnerLoginCode,
  RUNNER_LOGIN_TTL_MS,
  startRunnerLogin,
  sweepRunnerLogins,
} from "./runner-login";
import { authenticateRunner, hashRunnerToken } from "./runner-tokens";
import { createTestDb } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");
const later = new Date(now.getTime() + RUNNER_LOGIN_TTL_MS);

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values({ id: "user-1", name: "octocat", email: "o@example.com" });
});

describe("startRunnerLogin", () => {
  it("mints a code and a device secret and stores only the secret's hash", async () => {
    const login = await startRunnerLogin(db, { runnerName: " laptop ", now });

    expect(login.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(login.deviceSecret).toMatch(/^hkd_[A-Za-z0-9_-]{43}$/);
    expect(login.expiresAt).toEqual(later);

    const [row] = await db.select().from(schema.runnerLogin);
    expect(row).toMatchObject({
      code: login.code,
      runnerName: "laptop",
      deviceSecretHash: hashRunnerToken(login.deviceSecret),
      userId: null,
      runnerId: null,
      approvedAt: null,
    });
  });

  it("rejects a name with other characters", async () => {
    for (const runnerName of ["lap\ntop", "-x", "x".repeat(65)])
      await expect(startRunnerLogin(db, { runnerName })).rejects.toThrow();
  });

  it("rejects a blank name", async () => {
    await expect(startRunnerLogin(db, { runnerName: "  " })).rejects.toThrow(
      "a runner needs a name",
    );
  });
});

describe("codes", () => {
  it("formats with a dash and normalises case and the dash", () => {
    expect(formatRunnerLoginCode("ABCD2345")).toBe("ABCD-2345");
    expect(normalizeRunnerLoginCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeRunnerLoginCode(" ABCD2345 ")).toBe("ABCD2345");
  });

  it("rejects anything else", () => {
    for (const bad of ["", "ABCD", "ABC-D2345", "ABCD-234O", "ABCD-23451", "ABCD 2345"]) {
      expect(() => normalizeRunnerLoginCode(bad)).toThrow("a login code looks like XXXX-XXXX");
    }
  });
});

describe("approveRunnerLogin", () => {
  it("marks the login approved for the user without creating a runner yet", async () => {
    const login = await startRunnerLogin(db, { runnerName: "laptop", now });

    const approved = await approveRunnerLogin(db, {
      userId: "user-1",
      code: formatRunnerLoginCode(login.code).toLowerCase(),
      now,
    });

    expect(approved).toEqual({ runnerName: "laptop" });
    expect(await db.select().from(schema.runner)).toHaveLength(0);
    const [row] = await db.select().from(schema.runnerLogin);
    expect(row).toMatchObject({ userId: "user-1", runnerId: null, approvedAt: now });
  });

  it("throws on an unknown, approved or expired code", async () => {
    const login = await startRunnerLogin(db, { runnerName: "laptop", now });

    await expect(
      approveRunnerLogin(db, { userId: "user-1", code: "ZZZZ-ZZZZ", now }),
    ).rejects.toThrow("unknown login code");
    await expect(
      approveRunnerLogin(db, { userId: "user-1", code: login.code, now: later }),
    ).rejects.toThrow("this login code has expired");

    await approveRunnerLogin(db, { userId: "user-1", code: login.code, now });
    await expect(
      approveRunnerLogin(db, { userId: "user-1", code: login.code, now }),
    ).rejects.toThrow("this login code was already approved");
    expect(await db.select().from(schema.runner)).toHaveLength(0);
  });
});

describe("collectRunnerLogin", () => {
  it("is pending until approved, then mints the runner and hands the token out once", async () => {
    const { code, deviceSecret } = await startRunnerLogin(db, { runnerName: "laptop", now });

    expect(await collectRunnerLogin(db, { deviceSecret, now })).toEqual({ status: "pending" });

    await approveRunnerLogin(db, { userId: "user-1", code, now });
    const collected = await collectRunnerLogin(db, { deviceSecret, now });
    expect(collected.status).toBe("approved");
    const token = collected.status === "approved" ? collected.token : "";
    expect((await authenticateRunner(db, `Bearer ${token}`))?.name).toBe("laptop");

    const [row] = await db
      .select()
      .from(schema.runnerLogin)
      .where(eq(schema.runnerLogin.code, code));
    const [runner] = await db.select().from(schema.runner);
    expect(row).toMatchObject({ runnerId: runner?.id, collectedAt: now });
    expect(await collectRunnerLogin(db, { deviceSecret, now })).toEqual({ status: "expired" });
    expect(await db.select().from(schema.runner)).toHaveLength(1);
  });

  it("expires an unknown secret and a login past its time", async () => {
    const { deviceSecret } = await startRunnerLogin(db, { runnerName: "laptop", now });

    expect(await collectRunnerLogin(db, { deviceSecret: "hkd_nope", now })).toEqual({
      status: "expired",
    });
    expect(await collectRunnerLogin(db, { deviceSecret, now: later })).toEqual({
      status: "expired",
    });
    expect(await db.select().from(schema.runnerLogin)).toEqual([]);
  });

  it("never mints a runner for a login approved but not collected in time", async () => {
    const { code, deviceSecret } = await startRunnerLogin(db, { runnerName: "laptop", now });
    await approveRunnerLogin(db, { userId: "user-1", code, now });
    expect(await collectRunnerLogin(db, { deviceSecret, now: later })).toEqual({
      status: "expired",
    });
    expect(await db.select().from(schema.runner)).toHaveLength(0);
  });
});

describe("findRunnerLogin", () => {
  it("describes a pending, approved or expired code and returns nothing for an unknown one", async () => {
    const { code } = await startRunnerLogin(db, { runnerName: "laptop", now });
    expect(await findRunnerLogin(db, { code, now })).toEqual({
      runnerName: "laptop",
      createdAt: now,
      state: "pending",
    });
    expect((await findRunnerLogin(db, { code, now: later }))?.state).toBe("expired");
    await approveRunnerLogin(db, { userId: "user-1", code, now });
    expect((await findRunnerLogin(db, { code, now }))?.state).toBe("approved");
    expect(await findRunnerLogin(db, { code: "AAAA-AAAA", now })).toBeUndefined();
    expect(await findRunnerLogin(db, { code: "nope", now })).toBeUndefined();
  });
});

describe("sweep", () => {
  it("deletes expired logins when a new one starts or the sweep runs", async () => {
    const { code } = await startRunnerLogin(db, { runnerName: "old", now });
    await startRunnerLogin(db, { runnerName: "new", now: later });
    expect((await db.select().from(schema.runnerLogin)).map((row) => row.runnerName)).toEqual([
      "new",
    ]);
    expect(await findRunnerLogin(db, { code, now: later })).toBeUndefined();
    await sweepRunnerLogins(db, new Date(later.getTime() + RUNNER_LOGIN_TTL_MS));
    expect(await db.select().from(schema.runnerLogin)).toEqual([]);
  });
});
