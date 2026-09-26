import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { claimNextJob, createRun, requeueStaleJobs } from "./job-queue";
import { createRunnerToken } from "./runner-tokens";
import { queueJob } from "./test/pglite";
import { gate, holdingCommit, migrateOnce } from "./test/postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;

const suffix = randomUUID();
const armedPr = {
  id: `armed-${suffix}`,
  userId: `user-${suffix}`,
  installationId: `installation-${suffix}`,
  owner: `octo-${suffix}`,
  repo: "repo",
  number: 7,
};

describe.skipIf(!databaseUrl)("the stale requeue against two Postgres connections", () => {
  let first: ReturnType<typeof createDb>;
  let second: ReturnType<typeof createDb>;

  beforeAll(async () => {
    first = createDb(databaseUrl!);
    second = createDb(databaseUrl!);
    await migrateOnce(first);
  });

  afterAll(async () => {
    const jobs = first
      .select({ id: schema.job.id })
      .from(schema.job)
      .where(eq(schema.job.armedPrId, armedPr.id));
    await first.delete(schema.run).where(inArray(schema.run.jobId, jobs));
    await first.delete(schema.job).where(eq(schema.job.armedPrId, armedPr.id));
    await first.delete(schema.armedPr).where(eq(schema.armedPr.id, armedPr.id));
    await first.delete(schema.runner).where(eq(schema.runner.userId, armedPr.userId));
    await first
      .delete(schema.installation)
      .where(eq(schema.installation.id, armedPr.installationId));
    await first.delete(schema.user).where(eq(schema.user.id, armedPr.userId));
    await first.$client.end();
    await second.$client.end();
  });

  it("ends the abandoned run in the transaction that requeues the job, so no claim lands in between", async () => {
    await first
      .insert(schema.user)
      .values({ id: armedPr.userId, name: "octocat", email: `${suffix}@example.com` });
    await first
      .insert(schema.installation)
      .values({ id: armedPr.installationId, accountLogin: armedPr.owner, accountType: "User" });
    await first.insert(schema.armedPr).values(armedPr);
    const queued = await queueJob(first, {
      armedPrId: armedPr.id,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      headCurrentAt: new Date(),
      notBefore: new Date(Date.now() - 60 * 60_000),
    });
    const dead = await createRunnerToken(first, { userId: armedPr.userId, name: "laptop" });
    const alive = await createRunnerToken(first, { userId: armedPr.userId, name: "desktop" });
    await claimNextJob(first, {
      runnerId: dead.runner.id,
      userId: armedPr.userId,
      now: new Date(Date.now() - 10 * 60_000),
    });
    const abandoned = await createRun(first, { jobId: queued.id, runnerId: dead.runner.id });
    const entered = gate();
    const released = gate();

    const sweeping = requeueStaleJobs(
      holdingCommit(first, { entered: entered.open, released: released.opened }),
      { now: new Date(), userId: armedPr.userId },
    );
    const committedWithoutHolding = await Promise.race([
      entered.opened.then(() => false),
      sweeping.then(() => true),
    ]);
    const claimedMeanwhile = await claimNextJob(second, {
      runnerId: alive.runner.id,
      userId: armedPr.userId,
      now: new Date(),
    });
    released.open();
    await sweeping;

    expect(committedWithoutHolding).toBe(false);
    expect(claimedMeanwhile).toBeUndefined();
    const claimed = await claimNextJob(second, {
      runnerId: alive.runner.id,
      userId: armedPr.userId,
      now: new Date(),
    });
    expect(claimed?.id).toBe(queued.id);
    const fresh = await createRun(second, { jobId: queued.id, runnerId: alive.runner.id });
    const runs = await first
      .select({ id: schema.run.id, status: schema.run.status })
      .from(schema.run)
      .where(inArray(schema.run.id, [abandoned.id, fresh.id]));
    expect(runs.find((row) => row.id === abandoned.id)?.status).toBe("error");
    expect(runs.find((row) => row.id === fresh.id)?.status).toBe("running");
  });
});
