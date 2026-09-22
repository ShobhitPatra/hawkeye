import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { GitHubClient, ReviewResult } from "@hawkeye/core";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "./db/client";
import * as schema from "./db/schema";
import { createRun } from "./job-queue";
import { postReviewForRun } from "./review-posting";
import { createRunnerToken } from "./runner-tokens";
import { queueJob } from "./test/pglite";

const databaseUrl = process.env.TEST_DATABASE_URL;

const result: ReviewResult = {
  verdict: "changes_needed",
  summary: "needs work",
  lenses: ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"].map((name) => ({
    name,
    assessment: "ok",
  })) as ReviewResult["lenses"],
  findings: [],
};

function unsupported() {
  return vi.fn(() => {
    throw new Error("unexpected call");
  });
}

function createGitHub(): GitHubClient {
  return {
    installationTokenById: vi.fn(async () => "ghs_token"),
    installationToken: unsupported(),
    pullRequest: unsupported(),
    mergeBase: unsupported(),
    linkedIssue: unsupported(),
    reviews: vi.fn(async () => []),
    postReview: vi.fn(async () => ({
      url: "https://github.com/octo/repo/pull/7#pullrequestreview-9",
      id: "9",
    })),
    updateReview: unsupported(),
    review: unsupported(),
    createCommitStatus: vi.fn(async () => {}),
    listInstallationRepositories: unsupported(),
    listUserInstallations: unsupported(),
    botLogin: vi.fn(async () => "hawkeye-review[bot]"),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function holdingCommit(db: Db, hold: { entered: () => void; released: Promise<void> }): Db {
  return Object.assign(Object.create(db) as Db, {
    transaction: ((work: (tx: Db) => Promise<unknown>) =>
      db.transaction(async (tx) => {
        const outcome = await work(tx);
        hold.entered();
        await hold.released;
        return outcome;
      })) as Db["transaction"],
  });
}

const suffix = randomUUID();
const armedPr = {
  id: `armed-${suffix}`,
  userId: `user-${suffix}`,
  installationId: `installation-${suffix}`,
  owner: `octo-${suffix}`,
  repo: "repo",
  number: 7,
};

describe.skipIf(!databaseUrl)("the posting lock against two Postgres connections", () => {
  let first: ReturnType<typeof createDb>;
  let second: ReturnType<typeof createDb>;

  beforeAll(async () => {
    first = createDb(databaseUrl!);
    second = createDb(databaseUrl!);
    await migrate(first, { migrationsFolder: join(import.meta.dirname, "..", "drizzle") });
  });

  afterAll(async () => {
    const jobs = first
      .select({ id: schema.job.id })
      .from(schema.job)
      .where(eq(schema.job.armedPrId, armedPr.id));
    await first.delete(schema.reviewPosted).where(eq(schema.reviewPosted.armedPrId, armedPr.id));
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

  it("lets only the round holding the lock post", async () => {
    const headSha = "a".repeat(40);
    await first
      .insert(schema.user)
      .values({ id: armedPr.userId, name: "octocat", email: `${suffix}@example.com` });
    await first
      .insert(schema.installation)
      .values({ id: armedPr.installationId, accountLogin: armedPr.owner, accountType: "User" });
    await first.insert(schema.armedPr).values(armedPr);
    const queued = await queueJob(first, {
      armedPrId: armedPr.id,
      headSha,
      baseSha: "b".repeat(40),
      headCurrentAt: new Date(),
      notBefore: new Date(),
    });
    const { runner } = await createRunnerToken(first, { userId: armedPr.userId, name: "laptop" });
    const ownRun = await createRun(first, { jobId: queued.id, runnerId: runner.id });
    const [siblingJob] = await first
      .insert(schema.job)
      .values({
        armedPrId: armedPr.id,
        headSha,
        baseSha: "b".repeat(40),
        notBefore: new Date(),
        state: "done",
      })
      .returning({ id: schema.job.id });
    const siblingRun = await createRun(first, { jobId: siblingJob!.id, runnerId: runner.id });
    const github = createGitHub();
    const entered = gate();
    const released = gate();

    const holder = postReviewForRun(
      { db: holdingCommit(first, { entered: entered.open, released: released.opened }), github },
      { runId: ownRun.id, jobId: queued.id, armedPr, headSha, result, commentable: {} },
    );
    await entered.opened;
    const contender = postReviewForRun(
      { db: second, github },
      { runId: siblingRun.id, jobId: siblingJob!.id, armedPr, headSha, result, commentable: {} },
    );
    const settled = await Promise.race([
      contender.then(() => "contender finished"),
      new Promise((resolve) => setTimeout(() => resolve("contender waited"), 500)),
    ]);
    released.open();

    expect(settled).toBe("contender waited");
    await expect(holder).resolves.toBe("posted");
    await expect(contender).resolves.toBe("already-posted");
    expect(github.postReview).toHaveBeenCalledTimes(1);
  });
});
