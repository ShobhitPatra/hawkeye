import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { enqueueJob } from "./jobs";
import { RUNNER_ONLINE_WINDOW_MS, runnerStatus } from "./runner-status";
import { createRunnerToken, revokeRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");

let db: Db;

async function seen(runnerId: string, at: Date) {
  await db.update(schema.runner).set({ lastSeenAt: at }).where(eq(schema.runner.id, runnerId));
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values([
    { id: "user-1", name: "octocat", email: "o@example.com" },
    { id: "user-2", name: "hubot", email: "h@example.com" },
  ]);
});

describe("runnerStatus", () => {
  it("is offline with no runners or one never seen", async () => {
    expect(await runnerStatus(db, "user-1", now)).toEqual({ online: false, waitingJobs: 0 });
    await createRunnerToken(db, { userId: "user-1", name: "laptop" });
    expect(await runnerStatus(db, "user-1", now)).toEqual({ online: false, waitingJobs: 0 });
  });

  it("is online when an active runner was seen within the window", async () => {
    const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
    const recent = new Date(now.getTime() - RUNNER_ONLINE_WINDOW_MS);
    await seen(runner.id, recent);

    expect(await runnerStatus(db, "user-1", now)).toEqual({
      online: true,
      lastSeenAt: recent,
      waitingJobs: 0,
    });
    expect(await runnerStatus(db, "user-2", now)).toEqual({ online: false, waitingJobs: 0 });
  });

  it("is offline when the last sighting is stale or the runner is revoked", async () => {
    const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
    const stale = new Date(now.getTime() - RUNNER_ONLINE_WINDOW_MS - 1);
    await seen(runner.id, stale);
    expect(await runnerStatus(db, "user-1", now)).toMatchObject({
      online: false,
      lastSeenAt: stale,
    });

    await seen(runner.id, now);
    await revokeRunnerToken(db, { userId: "user-1", runnerId: runner.id });
    expect(await runnerStatus(db, "user-1", now)).toEqual({ online: false, waitingJobs: 0 });
  });

  it("counts only the user's queued jobs on active arms", async () => {
    await seedArmedPullRequest(db, { armedPrId: "armed-1", userId: "user-1", number: 1 });
    await seedArmedPullRequest(db, { armedPrId: "armed-2", userId: "user-1", number: 2 });
    await seedArmedPullRequest(db, { armedPrId: "armed-3", userId: "user-1", number: 3 });
    await seedArmedPullRequest(db, { armedPrId: "armed-4", userId: "user-2", number: 4 });
    for (const armedPrId of ["armed-1", "armed-2", "armed-3", "armed-4"]) {
      await enqueueJob(db, { armedPrId, headSha: "h", baseSha: "b", notBefore: now });
    }
    await db
      .update(schema.armedPr)
      .set({ disarmedAt: now })
      .where(eq(schema.armedPr.id, "armed-2"));
    await db.update(schema.job).set({ state: "done" }).where(eq(schema.job.armedPrId, "armed-3"));

    expect((await runnerStatus(db, "user-1", now)).waitingJobs).toBe(1);
    expect((await runnerStatus(db, "user-2", now)).waitingJobs).toBe(1);
  });
});
