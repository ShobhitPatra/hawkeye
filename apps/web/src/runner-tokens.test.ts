import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import {
  authenticateRunner,
  createRunnerToken,
  hashRunnerToken,
  listRunners,
  parseRunnerToken,
  revokeRunnerToken,
} from "./runner-tokens";
import { createTestDb } from "./test/pglite";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values([
    { id: "user-1", name: "octocat", email: "o@example.com" },
    { id: "user-2", name: "hubot", email: "h@example.com" },
  ]);
});

describe("createRunnerToken", () => {
  it("mints a prefixed token and stores only its hash", async () => {
    const { runner, token } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });

    expect(token).toMatch(/^hk_[A-Za-z0-9_-]{43}$/);
    expect(runner).toMatchObject({ userId: "user-1", name: "laptop", revokedAt: null });
    expect(runner.tokenHash).toBe(hashRunnerToken(token));
    expect(runner.tokenHash).not.toContain(token);
  });

  it("trims the name and rejects a blank one", async () => {
    const { runner } = await createRunnerToken(db, { userId: "user-1", name: "  desktop  " });
    expect(runner.name).toBe("desktop");
    await expect(createRunnerToken(db, { userId: "user-1", name: "   " })).rejects.toThrow(
      "a runner needs a name",
    );
    await expect(createRunnerToken(db, { userId: "user-1", name: "desk\ntop" })).rejects.toThrow(
      "a runner name uses",
    );
    const { runner: unicode } = await createRunnerToken(db, {
      userId: "user-1",
      name: "Büro-Laptop",
    });
    expect(unicode.name).toBe("Büro-Laptop");
  });

  it("mints a distinct token per runner", async () => {
    const first = await createRunnerToken(db, { userId: "user-1", name: "a" });
    const second = await createRunnerToken(db, { userId: "user-1", name: "b" });
    expect(second.token).not.toBe(first.token);
  });
});

describe("parseRunnerToken", () => {
  it("accepts a bearer header carrying a hawkeye token", () => {
    expect(parseRunnerToken("Bearer hk_abc")).toBe("hk_abc");
    expect(parseRunnerToken("bearer hk_abc")).toBe("hk_abc");
  });

  it("rejects anything else", () => {
    expect(parseRunnerToken(null)).toBeUndefined();
    expect(parseRunnerToken("")).toBeUndefined();
    expect(parseRunnerToken("hk_abc")).toBeUndefined();
    expect(parseRunnerToken("Basic hk_abc")).toBeUndefined();
    expect(parseRunnerToken("Bearer other")).toBeUndefined();
    expect(parseRunnerToken("Bearer hk_abc extra")).toBeUndefined();
  });
});

describe("authenticateRunner", () => {
  it("resolves the runner and bumps last seen", async () => {
    const { runner, token } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
    expect(runner.lastSeenAt).toBeNull();

    const authenticated = await authenticateRunner(db, `Bearer ${token}`);

    expect(authenticated?.id).toBe(runner.id);
    expect(authenticated?.lastSeenAt).toBeInstanceOf(Date);
  });

  it("stamps first seen once and keeps it while last seen moves on", async () => {
    const { runner, token } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
    expect(runner.firstSeenAt).toBeNull();

    const first = await authenticateRunner(db, `Bearer ${token}`);
    expect(first?.firstSeenAt).toEqual(first?.lastSeenAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await authenticateRunner(db, `Bearer ${token}`);
    expect(second?.firstSeenAt).toEqual(first?.firstSeenAt);
    expect(second!.lastSeenAt!.getTime()).toBeGreaterThan(first!.lastSeenAt!.getTime());
  });

  it("rejects an unknown, malformed or revoked token", async () => {
    const { runner, token } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });

    expect(await authenticateRunner(db, "Bearer hk_nope")).toBeUndefined();
    expect(await authenticateRunner(db, token)).toBeUndefined();
    expect(await authenticateRunner(db, undefined)).toBeUndefined();

    await revokeRunnerToken(db, { userId: "user-1", runnerId: runner.id });
    expect(await authenticateRunner(db, `Bearer ${token}`)).toBeUndefined();
  });
});

describe("revokeRunnerToken", () => {
  it("stamps revoked_at once", async () => {
    const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });

    const revoked = await revokeRunnerToken(db, { userId: "user-1", runnerId: runner.id });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);

    expect(await revokeRunnerToken(db, { userId: "user-1", runnerId: runner.id })).toBeUndefined();
  });

  it("leaves another user's runner alone", async () => {
    const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });

    expect(await revokeRunnerToken(db, { userId: "user-2", runnerId: runner.id })).toBeUndefined();

    const [row] = await db.select().from(schema.runner).where(eq(schema.runner.id, runner.id));
    expect(row?.revokedAt).toBeNull();
  });
});

describe("listRunners", () => {
  it("lists the user's runners newest first", async () => {
    const first = await createRunnerToken(db, { userId: "user-1", name: "a" });
    await db
      .update(schema.runner)
      .set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
      .where(eq(schema.runner.id, first.runner.id));
    const second = await createRunnerToken(db, { userId: "user-1", name: "b" });
    await createRunnerToken(db, { userId: "user-2", name: "other" });

    const rows = await listRunners(db, "user-1");

    expect(rows.map((row) => row.id)).toEqual([second.runner.id, first.runner.id]);
  });
});
