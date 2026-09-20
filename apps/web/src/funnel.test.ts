import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { keptFromPrevious, loadFunnel } from "./funnel";
import { createTestDb } from "./test/pglite";

let db: Db;

async function person(id: string, createdAt: string) {
  await db
    .insert(schema.user)
    .values({ id, name: id, email: `${id}@example.com`, createdAt: new Date(createdAt) });
}

beforeEach(async () => {
  db = await createTestDb();
  await db
    .insert(schema.installation)
    .values({ id: "10", accountLogin: "octo", accountType: "Organization" });
});

describe("loadFunnel", () => {
  it("is empty without users", async () => {
    expect(await loadFunnel(db)).toEqual({
      total: { signedIn: 0, installed: 0, connected: 0, online: 0, reviewed: 0 },
      weeks: [],
    });
  });

  it("counts how far each sign-up week's users got, newest week first", async () => {
    await person("only-signed-in", "2026-09-08T10:00:00Z");
    await person("installed", "2026-09-09T10:00:00Z");
    await person("connected", "2026-09-10T10:00:00Z");
    await person("online", "2026-09-15T10:00:00Z");
    await person("reviewed", "2026-09-16T10:00:00Z");
    for (const userId of ["installed", "connected", "online", "reviewed"])
      await db.insert(schema.installationUser).values({ installationId: "10", userId });
    await db.insert(schema.runner).values([
      { id: "r-connected", userId: "connected", name: "a", tokenHash: "h1" },
      { id: "r-online", userId: "online", name: "b", tokenHash: "h2", firstSeenAt: new Date() },
      { id: "r-reviewed", userId: "reviewed", name: "c", tokenHash: "h3", firstSeenAt: new Date() },
    ]);
    await db.insert(schema.armedPr).values({
      id: "armed-1",
      userId: "reviewed",
      installationId: "10",
      owner: "octo",
      repo: "repo",
      number: 1,
    });
    const [queued] = await db
      .insert(schema.job)
      .values({ armedPrId: "armed-1", headSha: "a", baseSha: "b", notBefore: new Date() })
      .returning();
    const [ran] = await db
      .insert(schema.run)
      .values({ jobId: queued!.id, runnerId: "r-reviewed" })
      .returning();
    await db
      .insert(schema.reviewPosted)
      .values([{ runId: ran!.id, armedPrId: "armed-1", headSha: "a", githubReviewId: "99" }]);

    const funnel = await loadFunnel(db);

    expect(funnel.weeks).toEqual([
      { weekStart: "2026-09-14", signedIn: 2, installed: 2, connected: 2, online: 2, reviewed: 1 },
      { weekStart: "2026-09-07", signedIn: 3, installed: 2, connected: 1, online: 0, reviewed: 0 },
    ]);
    expect(funnel.total).toEqual({
      signedIn: 5,
      installed: 4,
      connected: 3,
      online: 2,
      reviewed: 1,
    });
  });

  it("does not count a review still in flight", async () => {
    await person("waiting", "2026-09-16T10:00:00Z");
    await db
      .insert(schema.runner)
      .values({ id: "r1", userId: "waiting", name: "a", tokenHash: "h" });
    await db.insert(schema.armedPr).values({
      id: "armed-1",
      userId: "waiting",
      installationId: "10",
      owner: "octo",
      repo: "repo",
      number: 1,
    });
    const [queued] = await db
      .insert(schema.job)
      .values({ armedPrId: "armed-1", headSha: "a", baseSha: "b", notBefore: new Date() })
      .returning();
    const [ran] = await db
      .insert(schema.run)
      .values({ jobId: queued!.id, runnerId: "r1" })
      .returning();
    await db
      .insert(schema.reviewPosted)
      .values({ runId: ran!.id, armedPrId: "armed-1", headSha: "a" });

    expect((await loadFunnel(db)).total.reviewed).toBe(0);
  });
});

describe("keptFromPrevious", () => {
  const counts = { signedIn: 8, installed: 4, connected: 3, online: 0, reviewed: 0 };

  it("has no figure for the first step", () => {
    expect(keptFromPrevious(counts, "signedIn")).toBeUndefined();
  });

  it("rounds the share kept from the step before", () => {
    expect(keptFromPrevious(counts, "installed")).toBe(50);
    expect(keptFromPrevious(counts, "connected")).toBe(75);
    expect(keptFromPrevious(counts, "online")).toBe(0);
  });

  it("has no figure when the step before is empty", () => {
    expect(keptFromPrevious(counts, "reviewed")).toBeUndefined();
  });
});
