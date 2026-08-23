import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import {
  armPullRequest,
  armedPullRequestKey,
  disarmPullRequest,
  listArmedPullRequests,
} from "./arming";
import type { Db } from "./db/client";
import * as schema from "./db/schema";

const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite;

  await db.insert(schema.user).values([
    { id: "user-1", name: "octocat", email: "octocat@example.com" },
    { id: "user-2", name: "hubot", email: "hubot@example.com" },
  ]);
  await db.insert(schema.installation).values([
    { id: "10", accountLogin: "octo", accountType: "Organization" },
    { id: "20", accountLogin: "octo-two", accountType: "Organization" },
  ]);
});

function rowsFor(owner: string) {
  return db.select().from(schema.armedPr).where(eq(schema.armedPr.owner, owner));
}

describe("armPullRequest", () => {
  it("inserts an armed row", async () => {
    const armed = await armPullRequest(db, {
      userId: "user-1",
      installationId: "10",
      owner: "insert",
      repo: "repo",
      number: 1,
    });

    expect(armed).toMatchObject({
      userId: "user-1",
      installationId: "10",
      owner: "insert",
      repo: "repo",
      number: 1,
      disarmedAt: null,
    });
    expect(await rowsFor("insert")).toHaveLength(1);
  });

  it("returns the existing row when the pull request is already armed", async () => {
    const input = {
      userId: "user-1",
      installationId: "10",
      owner: "twice",
      repo: "repo",
      number: 2,
    };
    const first = await armPullRequest(db, input);
    const second = await armPullRequest(db, input);

    expect(second.id).toBe(first.id);
    expect(await rowsFor("twice")).toHaveLength(1);
  });

  it("updates the installation on an already-armed row when it changes", async () => {
    const input = {
      userId: "user-1",
      installationId: "10",
      owner: "reinstall",
      repo: "repo",
      number: 42,
    };
    const first = await armPullRequest(db, input);
    const second = await armPullRequest(db, { ...input, installationId: "20" });

    expect(second.id).toBe(first.id);
    expect(second.installationId).toBe("20");
    expect(await rowsFor("reinstall")).toHaveLength(1);
  });

  it("arms again after a disarm, leaving the disarmed row behind", async () => {
    const input = {
      userId: "user-1",
      installationId: "10",
      owner: "again",
      repo: "repo",
      number: 3,
    };
    const first = await armPullRequest(db, input);
    await disarmPullRequest(db, input);
    const second = await armPullRequest(db, input);

    expect(second.id).not.toBe(first.id);
    expect(second.disarmedAt).toBeNull();
    expect(await rowsFor("again")).toHaveLength(2);
  });
});

describe("disarmPullRequest", () => {
  it("stamps disarmed_at on the active row", async () => {
    await armPullRequest(db, {
      userId: "user-1",
      installationId: "10",
      owner: "off",
      repo: "repo",
      number: 4,
    });

    const disarmed = await disarmPullRequest(db, {
      userId: "user-1",
      owner: "off",
      repo: "repo",
      number: 4,
    });

    expect(disarmed?.disarmedAt).toBeInstanceOf(Date);
    expect(await listArmedPullRequests(db, "user-1")).not.toContain("off/repo#4");
  });

  it("returns nothing when the pull request is not armed", async () => {
    await expect(
      disarmPullRequest(db, { userId: "user-1", owner: "cold", repo: "repo", number: 5 }),
    ).resolves.toBeUndefined();
  });

  it("does not disarm another user's row", async () => {
    await armPullRequest(db, {
      userId: "user-1",
      installationId: "10",
      owner: "mine",
      repo: "repo",
      number: 6,
    });

    const disarmed = await disarmPullRequest(db, {
      userId: "user-2",
      owner: "mine",
      repo: "repo",
      number: 6,
    });

    expect(disarmed).toBeUndefined();
    expect(await listArmedPullRequests(db, "user-1")).toContain("mine/repo#6");
  });
});

describe("listArmedPullRequests", () => {
  it("returns only the user's active pull requests", async () => {
    await armPullRequest(db, {
      userId: "user-2",
      installationId: "10",
      owner: "theirs",
      repo: "repo",
      number: 7,
    });
    await armPullRequest(db, {
      userId: "user-2",
      installationId: "10",
      owner: "theirs",
      repo: "repo",
      number: 8,
    });
    await disarmPullRequest(db, { userId: "user-2", owner: "theirs", repo: "repo", number: 8 });

    const armed = await listArmedPullRequests(db, "user-2");

    expect(armed).toEqual(new Set(["theirs/repo#7"]));
  });

  it("keys rows as owner/repo#number", () => {
    expect(armedPullRequestKey({ owner: "octo", repo: "repo", number: 9 })).toBe("octo/repo#9");
  });
});
