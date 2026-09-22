import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { enqueueJob } from "./jobs";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db, { armedPrId: "armed-1", repo: "a", number: 1 });
  await seedArmedPullRequest(db, { armedPrId: "armed-2", repo: "b", number: 2 });
  await db
    .insert(schema.runner)
    .values({ id: "runner-1", userId: "user-1", name: "laptop", tokenHash: "hash" });
});

function jobsFor(armedPrId: string) {
  return db.select().from(schema.job).where(eq(schema.job.armedPrId, armedPrId));
}

describe("enqueueJob", () => {
  it("inserts a queued job", async () => {
    const notBefore = new Date("2026-01-01T00:00:00.000Z");
    const enqueued = await enqueueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      notBefore,
    });

    expect(enqueued).toMatchObject({
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      state: "queued",
    });
    expect(enqueued.notBefore.toISOString()).toBe(notBefore.toISOString());
    expect(await jobsFor("armed-1")).toHaveLength(1);
  });

  it("collapses a second enqueue onto the waiting job", async () => {
    const first = await enqueueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "1".repeat(40),
      baseSha: "2".repeat(40),
      notBefore: new Date("2026-01-01T00:00:00.000Z"),
    });
    const notBefore = new Date("2026-01-01T00:05:00.000Z");
    const second = await enqueueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "3".repeat(40),
      baseSha: "4".repeat(40),
      notBefore,
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      headSha: "3".repeat(40),
      baseSha: "4".repeat(40),
      state: "queued",
    });
    expect(second.notBefore.toISOString()).toBe(notBefore.toISOString());
    expect(await jobsFor("armed-2")).toHaveLength(1);
  });

  it("discards an enqueue whose head is older than the waiting job's", async () => {
    await seedArmedPullRequest(db, { armedPrId: "armed-3", repo: "c", number: 3 });
    const newer = await enqueueJob(db, {
      armedPrId: "armed-3",
      headSha: "5".repeat(40),
      baseSha: "6".repeat(40),
      headCurrentAt: new Date("2026-01-01T00:00:05.000Z"),
      notBefore: new Date("2026-01-01T00:00:05.000Z"),
    });
    const older = await enqueueJob(db, {
      armedPrId: "armed-3",
      headSha: "7".repeat(40),
      baseSha: "8".repeat(40),
      headCurrentAt: new Date("2026-01-01T00:00:00.000Z"),
      notBefore: new Date("2026-01-01T00:10:00.000Z"),
    });

    expect(older).toEqual(newer);
    expect(await jobsFor("armed-3")).toEqual([newer]);
  });

  it("enqueues a new job when the waiting job was claimed", async () => {
    const claimed = await enqueueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "5".repeat(40),
      baseSha: "6".repeat(40),
      notBefore: new Date("2026-01-01T00:10:00.000Z"),
    });
    await db
      .update(schema.job)
      .set({ state: "claimed", claimedByRunnerId: "runner-1", claimedAt: new Date() })
      .where(eq(schema.job.id, claimed.id));

    const fresh = await enqueueJob(db, {
      headCurrentAt: new Date(),
      armedPrId: "armed-2",
      headSha: "7".repeat(40),
      baseSha: "8".repeat(40),
      notBefore: new Date("2026-01-01T00:15:00.000Z"),
    });

    expect(fresh.id).not.toBe(claimed.id);
    expect(fresh.state).toBe("queued");
    const rows = await jobsFor("armed-2");
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.state === "queued")).toHaveLength(1);
  });
});
