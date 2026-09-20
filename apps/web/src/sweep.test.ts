import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { claimNextJob } from "./job-queue";
import { enqueueJob } from "./jobs";
import { claimJob } from "./runner-api";
import { createRunnerToken } from "./runner-tokens";
import { sweep } from "./sweep";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const now = new Date("2026-01-01T12:00:00.000Z");
const minutesBefore = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const secret = "s3cret";
let db: Db;
let runnerId: string;
let token: string;

function request(authorization?: string, method = "POST") {
  return new Request("https://hawkeye.test/api/internal/sweep", {
    method,
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });
}

async function staleClaim(): Promise<string> {
  const queued = await enqueueJob(db, {
    armedPrId: "armed-1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    notBefore: minutesBefore(20),
  });
  await claimNextJob(db, { runnerId, userId: "user-1", now: minutesBefore(10) });
  return queued.id;
}

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  const created = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
  runnerId = created.runner.id;
  token = created.token;
});

describe("sweep", () => {
  it("refuses a caller without the secret, with a wrong one, or when none is configured", async () => {
    const jobId = await staleClaim();
    for (const [authorization, configured] of [
      [undefined, secret],
      ["Bearer wrong!", secret],
      [`Bearer ${secret}`, undefined],
      [secret, secret],
    ] as const) {
      const response = await sweep(request(authorization), {
        db,
        secret: configured,
        now: () => now,
      });
      expect(response.status).toBe(401);
    }
    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(row?.state).toBe("claimed");
  });

  it("requeues stale claims for a caller with the secret, on GET and POST", async () => {
    const jobId = await staleClaim();
    const first = await sweep(request(`Bearer ${secret}`, "GET"), { db, secret, now: () => now });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, swept: 1 });
    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, jobId));
    expect(row?.state).toBe("queued");
    const again = await sweep(request(`Bearer ${secret}`), { db, secret, now: () => now });
    expect(await again.json()).toEqual({ ok: true, swept: 0 });
  });
});

describe("claimJob", () => {
  it("does not sweep: another user's stale claim is left for the schedule", async () => {
    await db.insert(schema.user).values({ id: "user-2", name: "hubot", email: "h@example.com" });
    await seedArmedPullRequest(db, {
      armedPrId: "armed-2",
      userId: "user-2",
      repo: "other",
      number: 2,
    });
    const other = await createRunnerToken(db, { userId: "user-2", name: "desk" });
    const stale = await enqueueJob(db, {
      armedPrId: "armed-2",
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: minutesBefore(20),
    });
    await claimNextJob(db, { runnerId: other.runner.id, userId: "user-2", now: minutesBefore(10) });

    const response = await claimJob(
      new Request("https://hawkeye.test/api/runner/jobs", {
        headers: { authorization: `Bearer ${token}` },
      }),
      {
        db,
        github: {} as never,
        now: () => now,
        poll: { intervalMs: 0, totalMs: 0 },
        controlPlaneUrl: "https://hawkeye.test",
      },
    );

    expect(response.status).toBe(204);
    const [row] = await db.select().from(schema.job).where(eq(schema.job.id, stale.id));
    expect(row?.state).toBe("claimed");
  });
});
