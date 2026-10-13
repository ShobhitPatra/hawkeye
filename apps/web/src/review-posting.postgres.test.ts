import { randomUUID } from "node:crypto";
import type { GitHubClient, ReviewResult } from "@hawkeye/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { createRun } from "./job-queue";
import { postReviewForRun } from "./review-posting";
import { clearReviewing, NOT_COMPLETED_BODY } from "./reviewing-line";
import { createRunnerToken } from "./runner-tokens";
import { queueJob } from "./test/pglite";
import { gate, holdingCommit, migrateOnce } from "./test/postgres";

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
    listUserInstallationRepositories: unsupported(),
    appSlug: unsupported(),
    botLogin: vi.fn(async () => "hawkeye-review[bot]"),
    reviewComments: unsupported(),
    replyToReviewComment: unsupported(),
    reviewThreads: unsupported(),
    resolveReviewThread: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
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
const cleared = { ...armedPr, id: `armed-cleared-${suffix}`, number: 8 };
const armedIds = [armedPr.id, cleared.id];

describe.skipIf(!databaseUrl)("the posting lock against two Postgres connections", () => {
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
      .where(inArray(schema.job.armedPrId, armedIds));
    await first.delete(schema.reviewPosted).where(inArray(schema.reviewPosted.armedPrId, armedIds));
    await first.delete(schema.run).where(inArray(schema.run.jobId, jobs));
    await first.delete(schema.job).where(inArray(schema.job.armedPrId, armedIds));
    await first.delete(schema.armedPr).where(inArray(schema.armedPr.id, armedIds));
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
  it("keeps a round that lands while another run clears the badge", async () => {
    await first
      .insert(schema.user)
      .values({ id: armedPr.userId, name: "octocat", email: `${suffix}@example.com` })
      .onConflictDoNothing();
    await first
      .insert(schema.installation)
      .values({ id: armedPr.installationId, accountLogin: armedPr.owner, accountType: "User" })
      .onConflictDoNothing();
    await first.insert(schema.armedPr).values(cleared);
    const { runner } = await createRunnerToken(first, { userId: armedPr.userId, name: "desktop" });
    const [previousJob] = await first
      .insert(schema.job)
      .values({
        armedPrId: cleared.id,
        headSha: "d".repeat(40),
        baseSha: "b".repeat(40),
        notBefore: new Date(),
        state: "done",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning({ id: schema.job.id });
    const previousRun = await createRun(first, { jobId: previousJob!.id, runnerId: runner.id });
    await first
      .update(schema.run)
      .set({ status: "ok", result })
      .where(eq(schema.run.id, previousRun.id));
    await first.insert(schema.reviewPosted).values({
      runId: previousRun.id,
      armedPrId: cleared.id,
      headSha: "d".repeat(40),
      githubReviewId: "5",
    });
    const headSha = "c".repeat(40);
    const queued = await queueJob(first, {
      armedPrId: cleared.id,
      headSha,
      baseSha: "b".repeat(40),
      headCurrentAt: new Date(),
      notBefore: new Date(),
    });
    const ownRun = await createRun(first, { jobId: queued.id, runnerId: runner.id });
    await first
      .update(schema.run)
      .set({ status: "ok", result })
      .where(eq(schema.run.id, ownRun.id));

    let body =
      "<!-- hawkeye: reviewing -->\n![Reviewing on laptop](badge)\n<!-- /hawkeye: reviewing -->\n\nthe previous round";
    const read = gate();
    const resume = gate();
    const github = createGitHub();
    github.review = vi.fn(async () => {
      const seen = body;
      read.open();
      await resume.opened;
      return { body: seen };
    }) as GitHubClient["review"];
    github.updateReview = vi.fn(async (_reference, _reviewId, next: string) => {
      body = next;
    });
    let clearing: Promise<void> | undefined;
    github.installationTokenById = vi.fn(async () => {
      clearing ??= clearReviewing(
        { db: second, github },
        {
          reference: { owner: cleared.owner, repo: cleared.repo, number: cleared.number },
          headSha,
          token: "ghs_token",
          runId: previousRun.id,
          livingReviewId: "5",
          placeholderReviewId: null,
          closing: NOT_COMPLETED_BODY,
        },
      );
      await read.opened;
      setTimeout(resume.open, 300);
      return "ghs_token";
    });

    await expect(
      postReviewForRun(
        { db: first, github },
        { runId: ownRun.id, jobId: queued.id, armedPr: cleared, headSha, result, commentable: {} },
      ),
    ).resolves.toBe("posted");
    await clearing;
    expect(body).toContain(`<!-- hawkeye: head=${headSha} -->`);
    expect(body).not.toContain("the previous round");
  });
});
