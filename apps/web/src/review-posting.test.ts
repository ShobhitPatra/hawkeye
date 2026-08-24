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
const armedPr = { id: "armed-1", installationId: "10", owner: "octo", repo: "repo", number: 7 };
const result: ReviewResult = {
  verdict: "revise",
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
    listInstallationRepositories: unsupported(),
    listOpenPullRequestsByAuthor: unsupported(),
  };
}

let db: Db;
let github: GitHubClient;
let runId: string;

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
  runId = (await createRun(db, { jobId: queued.id, runnerId: runner.id })).id;
  github = createGitHub();
});

const post = (commentable: Record<string, number[]> = { "a.txt": [1, 2] }) =>
  postReviewForRun({ db, github }, { runId, armedPr, headSha, result, commentable });

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

  it("treats a lost insert race as already posted", async () => {
    github.postReview = vi.fn(async () => {
      await db.insert(schema.reviewPosted).values({
        runId,
        armedPrId: armedPr.id,
        headSha,
        githubReviewId: "1",
      });
      return { url: "https://github.com/octo/repo/pull/7#pullrequestreview-2", id: "2" };
    });

    await expect(post()).resolves.toBe("already-posted");
    const rows = await db.select().from(schema.reviewPosted);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.githubReviewId).toBe("1");
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
        { runId, armedPr, headSha, result, commentable: { "a.txt": [2] } },
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
