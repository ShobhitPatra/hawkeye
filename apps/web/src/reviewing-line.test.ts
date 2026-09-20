import type { GitHubClient } from "@hawkeye/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import {
  clearReviewing,
  hasReviewingBlock,
  markReviewing,
  reviewingBadgeSvg,
  reviewingBlock,
  stripReviewingBlock,
} from "./reviewing-line";
import { createRunnerToken } from "./runner-tokens";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const reference = { owner: "octo", repo: "repo", number: 7 };
const block = reviewingBlock({
  controlPlaneUrl: "https://hawkeye.review",
  runnerName: "laptop",
  startedAt: new Date("2026-09-06T03:47:12Z"),
});

let db: Db;
let runId: string;

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
  const { runner } = await createRunnerToken(db, { userId: "user-1", name: "laptop" });
  const [job] = await db
    .insert(schema.job)
    .values({
      armedPrId: "armed-1",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      notBefore: new Date(),
      state: "claimed",
    })
    .returning();
  const [created] = await db
    .insert(schema.run)
    .values({ jobId: job!.id, runnerId: runner.id })
    .returning();
  runId = created!.id;
});

describe("reviewing block", () => {
  it("wraps the badge and the started sentence in markers and strips cleanly", () => {
    expect(block).toContain(
      "![Reviewing on laptop](https://hawkeye.review/status/reviewing?runner=laptop)",
    );
    expect(block).toContain("Started 03:47 UTC. This comment is replaced when the review lands.");
    const body = `${block}<!-- hawkeye: head=abc -->\n\n### Ship\n`;
    expect(hasReviewingBlock(body)).toBe(true);
    expect(stripReviewingBlock(body)).toBe("<!-- hawkeye: head=abc -->\n\n### Ship\n");
    expect(hasReviewingBlock(stripReviewingBlock(body))).toBe(false);
  });

  it("renders an animated badge that escapes the runner name", () => {
    const svg = reviewingBadgeSvg('la<p>top"');
    expect(svg).toContain("<animateTransform");
    expect(svg).toContain("Reviewing on la&#60;p&#62;top&#34;");
    expect(svg).not.toContain("<p>");
  });
});

describe("markReviewing", () => {
  it("prepends the block to an existing living review", async () => {
    const github = {
      review: vi.fn(async () => ({ body: "<!-- hawkeye: head=old -->\n\n### Ship\n" })),
      updateReview: vi.fn(async () => {}),
      postReview: vi.fn(),
    } as unknown as GitHubClient;
    await markReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: "5",
        closedPlaceholderId: undefined,
        block,
      },
    );
    expect(github.updateReview).toHaveBeenCalledWith(
      reference,
      "5",
      `${block}<!-- hawkeye: head=old -->\n\n### Ship\n`,
      "t",
    );
    expect(github.postReview).not.toHaveBeenCalled();
  });

  it("does not stack a second block on a body that already has one", async () => {
    const github = {
      review: vi.fn(async () => ({ body: `${block}old body` })),
      updateReview: vi.fn(async () => {}),
    } as unknown as GitHubClient;
    await markReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: "5",
        closedPlaceholderId: undefined,
        block,
      },
    );
    expect((github.updateReview as ReturnType<typeof vi.fn>).mock.calls[0]![2]).toBe(
      `${block}old body`,
    );
  });

  it("posts a placeholder review and remembers it on the run when nothing is posted yet", async () => {
    const github = {
      postReview: vi.fn(async () => ({ url: "u", id: "42" })),
    } as unknown as GitHubClient;
    await markReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: undefined,
        closedPlaceholderId: undefined,
        block,
      },
    );
    expect(github.postReview).toHaveBeenCalledWith(
      reference,
      { event: "COMMENT", commit_id: "a".repeat(40), body: block, comments: [] },
      "t",
    );
    const [row] = await db.select().from(schema.run);
    expect(row?.placeholderReviewId).toBe("42");
  });

  it("reuses a closed placeholder instead of posting another", async () => {
    const github = {
      updateReview: vi.fn(async () => {}),
      postReview: vi.fn(),
    } as unknown as GitHubClient;
    await markReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: undefined,
        closedPlaceholderId: "42",
        block,
      },
    );
    expect(github.updateReview).toHaveBeenCalledWith(reference, "42", block, "t");
    expect(github.postReview).not.toHaveBeenCalled();
    const [row] = await db.select().from(schema.run);
    expect(row?.placeholderReviewId).toBe("42");
  });

  it("logs and swallows a GitHub failure", async () => {
    const log = vi.fn();
    const github = {
      postReview: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as unknown as GitHubClient;
    await markReviewing(
      { db, github, log },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: undefined,
        closedPlaceholderId: undefined,
        block,
      },
    );
    expect(log).toHaveBeenCalledWith(`reviewing line not written for run ${runId}: nope`);
  });
});

describe("clearReviewing", () => {
  it("leaves a reused placeholder alone once it is the living review", async () => {
    const github = {
      review: vi.fn(async () => ({ body: "### Ship\n" })),
      updateReview: vi.fn(async () => {}),
    } as unknown as GitHubClient;
    await clearReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: "42",
        placeholderReviewId: "42",
        closing: "done",
      },
    );
    expect(github.updateReview).not.toHaveBeenCalled();
  });

  it("replaces a placeholder with the closing sentence", async () => {
    const github = { updateReview: vi.fn(async () => {}) } as unknown as GitHubClient;
    await clearReviewing(
      { db, github },
      {
        reference,
        headSha: "a".repeat(40),
        token: "t",
        runId,
        livingReviewId: undefined,
        placeholderReviewId: "42",
        closing: "done",
      },
    );
    expect(github.updateReview).toHaveBeenCalledWith(reference, "42", "done", "t");
  });

  it("leaves the living review alone when a newer run owns its block, but still closes a placeholder", async () => {
    const github = {
      review: vi.fn(async () => ({ body: "<!-- hawkeye: reviewing -->\n### Ship\n" })),
      updateReview: vi.fn(async () => {}),
    } as unknown as GitHubClient;
    const livingBlockBelongsToNewerRun = vi.fn(async () => true);
    const target = { reference, headSha: "a".repeat(40), token: "t", runId, closing: "done" };
    await clearReviewing(
      { db, github },
      { ...target, livingReviewId: "42", placeholderReviewId: null, livingBlockBelongsToNewerRun },
    );
    expect(github.review).not.toHaveBeenCalled();
    expect(github.updateReview).not.toHaveBeenCalled();
    await clearReviewing(
      { db, github },
      { ...target, livingReviewId: "42", placeholderReviewId: "7", livingBlockBelongsToNewerRun },
    );
    expect(github.updateReview).toHaveBeenCalledWith(reference, "7", "done", "t");
    expect(livingBlockBelongsToNewerRun).toHaveBeenCalledTimes(1);
  });

  it("strips the block from a living review and leaves an untouched body alone", async () => {
    const updateReview = vi.fn(async () => {});
    const github = {
      review: vi.fn(async () => ({ body: `${block}### Ship\n` })),
      updateReview,
    } as unknown as GitHubClient;
    const input = {
      reference,
      headSha: "a".repeat(40),
      token: "t",
      runId,
      livingReviewId: "5",
      placeholderReviewId: null,
      closing: "done",
    };
    await clearReviewing({ db, github }, input);
    expect(updateReview).toHaveBeenCalledWith(reference, "5", "### Ship\n", "t");
    (github.review as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ body: "### Ship\n" });
    await clearReviewing({ db, github }, input);
    expect(updateReview).toHaveBeenCalledTimes(1);
  });
});
