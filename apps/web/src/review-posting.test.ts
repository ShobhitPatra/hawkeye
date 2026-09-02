import { type GitHubClient, GitHubRequestError, type ReviewResult } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { enqueueJob } from "./jobs";
import { createRun } from "./job-queue";
import { postReviewForRun } from "./review-posting";
import { createRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const headSha = "a".repeat(40);
const previousHead = "c".repeat(40);
const armedPr = {
  id: "armed-1",
  userId: "user-1",
  installationId: "10",
  owner: "octo",
  repo: "repo",
  number: 7,
};
const result: ReviewResult = {
  verdict: "changes_needed",
  summary: "needs work",
  lenses: ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"].map((name) => ({
    name,
    assessment: "ok",
  })) as ReviewResult["lenses"],
  findings: [
    { path: "a.txt", line: 2, severity: "should_fix", claim: "anchored", detail: "d" },
    { path: "a.txt", line: 9, severity: "should_fix", claim: "unanchored", detail: "d" },
  ],
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
    reviews: unsupported(),
    postReview: vi.fn(async () => ({
      url: "https://github.com/octo/repo/pull/7#pullrequestreview-9",
      id: "9",
    })),
    updateReview: unsupported(),
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

let db: Db;
let github: GitHubClient;
let runId: string;
let jobId: string;
let runnerId: string;

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  const queued = await enqueueJob(db, {
    armedPrId: armedPr.id,
    headSha,
    baseSha: "b".repeat(40),
    notBefore: new Date(),
  });
  const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
  runnerId = runner.id;
  jobId = queued.id;
  runId = (await createRun(db, { jobId: queued.id, runnerId: runner.id })).id;
  github = createGitHub();
});

async function seedLivingReview(previousResult: ReviewResult) {
  const [previousJob] = await db
    .insert(schema.job)
    .values({
      armedPrId: armedPr.id,
      headSha: previousHead,
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "done",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning({ id: schema.job.id });
  const [previousRun] = await db
    .insert(schema.run)
    .values({
      jobId: previousJob!.id,
      runnerId,
      status: "ok",
      result: previousResult,
      startedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning({ id: schema.run.id });
  await db.insert(schema.reviewPosted).values({
    runId: previousRun!.id,
    armedPrId: armedPr.id,
    headSha: previousHead,
    githubReviewId: "5",
    postedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await db
    .update(schema.run)
    .set({ status: "ok", result, startedAt: new Date("2026-01-02T00:00:00Z") })
    .where(eq(schema.run.id, runId));
}

const post = (commentable: Record<string, number[]> = { "a.txt": [1, 2] }) =>
  postReviewForRun({ db, github }, { runId, jobId, armedPr, headSha, result, commentable });

describe("postReviewForRun", () => {
  it("renders, posts as the installation and records the review", async () => {
    await expect(post()).resolves.toBe("posted");

    expect(github.installationTokenById).toHaveBeenCalledWith("10");
    const [reference, review, token] = (github.postReview as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(reference).toEqual({ owner: "octo", repo: "repo", number: 7 });
    expect(token).toBe("ghs_token");
    expect(review.commit_id).toBe(headSha);
    expect(review.body).toContain(`<!-- hawkeye: head=${headSha} -->`);
    expect(review.body).toContain("https://github.com/ShobhitPatra/hawkeye");
    expect(review.comments).toHaveLength(1);
    expect(review.comments[0]).toMatchObject({ path: "a.txt", line: 2, side: "RIGHT" });
    expect(review.comments[0].body).toContain("anchored");
    expect(review.body).toContain("**unanchored**");
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId, armedPrId: "armed-1", headSha, githubReviewId: "9" });
  });

  it("posts body only when no commentable lines are known", async () => {
    await expect(post({})).resolves.toBe("posted");
    const review = (github.postReview as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(review.comments).toEqual([]);
  });

  it("skips GitHub entirely when the head was already posted", async () => {
    await db.insert(schema.reviewPosted).values({
      runId,
      armedPrId: armedPr.id,
      headSha,
      githubReviewId: "1",
    });

    await expect(post()).resolves.toBe("already-posted");
    expect(github.installationTokenById).not.toHaveBeenCalled();
    expect(github.postReview).not.toHaveBeenCalled();
  });

  it("skips a head another arm of the same pull request already posted", async () => {
    await db.insert(schema.armedPr).values({
      id: "armed-0",
      userId: "user-1",
      installationId: armedPr.installationId,
      owner: armedPr.owner,
      repo: armedPr.repo,
      number: armedPr.number,
      disarmedAt: new Date(),
    });
    await db.insert(schema.reviewPosted).values({
      runId,
      armedPrId: "armed-0",
      headSha,
      githubReviewId: "1",
    });

    await expect(post()).resolves.toBe("already-posted");
    expect(github.postReview).not.toHaveBeenCalled();
  });
  it("patches the living review and posts new findings as a supplemental review", async () => {
    github.updateReview = vi.fn(async () => {});
    await seedLivingReview({
      ...result,
      findings: [
        { path: "a.txt", line: 9, severity: "should_fix", claim: "unanchored", detail: "d" },
      ],
    });

    await expect(post()).resolves.toBe("posted");
    const [reference, reviewId, body, token] = (github.updateReview as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(reference).toEqual({ owner: "octo", repo: "repo", number: 7 });
    expect(reviewId).toBe("5");
    expect(token).toBe("ghs_token");
    expect(body).toContain(`<!-- hawkeye: head=${headSha} -->`);
    expect(body).toContain("### Rounds");
    expect(body).toContain(`| 1 | \`${"c".repeat(7)}\` | changes needed |`);
    expect(body).toContain(`| 2 | \`${"a".repeat(7)}\` | changes needed |`);
    const [, supplemental] = (github.postReview as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(supplemental.commit_id).toBe(headSha);
    expect(supplemental.body).toBe(`<!-- hawkeye: head=${headSha} -->`);
    expect(supplemental.comments).toHaveLength(1);
    expect(supplemental.comments[0]).toMatchObject({ path: "a.txt", line: 2, side: "RIGHT" });
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.headSha === headSha)).toMatchObject({
      runId,
      githubReviewId: "9",
    });
    expect(rows.find((row) => row.headSha === previousHead)?.githubReviewId).toBe("5");
  });

  it("patches the living review without a supplemental review when nothing is new", async () => {
    github.updateReview = vi.fn(async () => {});
    await seedLivingReview(result);

    await expect(post()).resolves.toBe("posted");
    expect(github.updateReview).toHaveBeenCalledTimes(1);
    expect(github.postReview).not.toHaveBeenCalled();
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows.find((row) => row.headSha === headSha)).toMatchObject({
      runId,
      githubReviewId: "5",
    });
  });

  it("returns superseded when a newer round of the pull request is already done", async () => {
    await db.insert(schema.job).values({
      armedPrId: armedPr.id,
      headSha: "d".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "done",
    });

    await expect(post()).resolves.toBe("superseded");
    expect(github.installationTokenById).not.toHaveBeenCalled();
    expect(github.postReview).not.toHaveBeenCalled();
    expect(await db.select().from(schema.reviewPosted)).toHaveLength(0);
  });

  it("re-patches the living body without inline comments when the supplemental hits a 422", async () => {
    github.updateReview = vi.fn(async () => {});
    github.postReview = vi.fn(async () => {
      throw new GitHubRequestError(422, "GitHub POST failed: 422");
    });
    await seedLivingReview({ ...result, findings: [] });

    await expect(post()).resolves.toBe("posted");
    expect(github.updateReview).toHaveBeenCalledTimes(1);
    const patchedBody = (github.updateReview as ReturnType<typeof vi.fn>).mock
      .calls[0]![2] as string;
    expect(patchedBody).not.toContain("(inline)");
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows.find((row) => row.headSha === headSha)).toMatchObject({ githubReviewId: "5" });
  });

  it("fails the round and records nothing when the supplemental fails for another reason", async () => {
    github.updateReview = vi.fn(async () => {});
    github.postReview = vi.fn(async () => {
      throw new GitHubRequestError(502, "GitHub POST failed: 502");
    });
    await seedLivingReview({ ...result, findings: [] });

    await expect(post()).resolves.toBe("failed");
    expect(github.updateReview).not.toHaveBeenCalled();
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows.find((row) => row.headSha === headSha)).toBeUndefined();
  });

  it("records the supplemental when it posted but the living patch failed", async () => {
    github.updateReview = vi.fn(async () => {
      throw new GitHubRequestError(500, "GitHub PUT failed: 500");
    });
    await seedLivingReview({ ...result, findings: [] });

    await expect(post()).resolves.toBe("failed");
    expect(github.postReview).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows.find((row) => row.headSha === headSha)).toMatchObject({ githubReviewId: "9" });
  });

  it("shares one living review across users arming the same pull request", async () => {
    github.updateReview = vi.fn(async () => {});
    await seedLivingReview(result);
    await db.insert(schema.user).values({ id: "user-2", name: "other", email: "x@example.com" });
    const [otherArm] = await db
      .insert(schema.armedPr)
      .values({
        userId: "user-2",
        installationId: armedPr.installationId,
        owner: armedPr.owner,
        repo: armedPr.repo,
        number: armedPr.number,
      })
      .returning();

    const outcome = await postReviewForRun(
      { db, github },
      {
        runId,
        jobId,
        armedPr: otherArm!,
        headSha,
        result,
        commentable: {},
      },
    );
    expect(outcome).toBe("posted");
    expect(github.updateReview).toHaveBeenCalledWith(
      expect.anything(),
      "5",
      expect.any(String),
      expect.anything(),
    );
    expect(github.postReview).not.toHaveBeenCalled();
  });

  it("records nothing and marks the run failed when the patch fails", async () => {
    github.updateReview = vi.fn(async () => {
      throw new GitHubRequestError(500, "GitHub PUT failed: 500");
    });
    await seedLivingReview(result);

    await expect(post()).resolves.toBe("failed");
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.headSha).toBe(previousHead);
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row?.error).toBe("post: GitHub PUT failed: 500");
  });

  it("falls back to body only on a 422", async () => {
    const log = vi.fn();
    github.postReview = vi
      .fn()
      .mockRejectedValueOnce(new GitHubRequestError(422, "failed: 422"))
      .mockResolvedValueOnce({
        url: "https://github.com/octo/repo/pull/7#pullrequestreview-3",
        id: "3",
      });

    await expect(
      postReviewForRun(
        { db, github, log },
        { runId, jobId, armedPr, headSha, result, commentable: { "a.txt": [2] } },
      ),
    ).resolves.toBe("posted");
    const calls = (github.postReview as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1].comments).toEqual([]);
    expect(log).toHaveBeenCalledWith("inline anchors rejected (422); posting body only");
    const [row] = await db.select().from(schema.reviewPosted);
    expect(row?.githubReviewId).toBe("3");
  });

  it("records the failure on the run and keeps its status", async () => {
    github.installationTokenById = vi.fn(async () => {
      throw new Error("no installation");
    });

    await expect(post()).resolves.toBe("failed");
    const [row] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(row).toMatchObject({ status: "running", error: "post: no installation" });
    expect(github.postReview).not.toHaveBeenCalled();
    expect(await db.select().from(schema.reviewPosted)).toHaveLength(0);
  });
});
