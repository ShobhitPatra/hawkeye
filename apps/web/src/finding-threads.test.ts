import type { GitHubClient } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import { closeFindingThreads, closingReply } from "./finding-threads";

const reference = { owner: "octo", repo: "repo", number: 7 };

function client(threads: { id: string; isResolved: boolean; commentIds: string[] }[]) {
  return {
    reviewThreads: vi.fn(async () => threads),
    replyToReviewComment: vi.fn(async () => {}),
    resolveReviewThread: vi.fn(async () => {}),
  } as unknown as GitHubClient;
}

describe("closeFindingThreads", () => {
  it("replies with the head and resolves the thread of an addressed finding", async () => {
    const github = client([{ id: "T1", isResolved: false, commentIds: ["91"] }]);
    const closed = await closeFindingThreads(github, {
      reference,
      token: "t",
      headSha: "b".repeat(40),
      round: 2,
      closed: [{ stableId: "f1", status: "addressed", commentId: "91" }],
    });
    expect(closed).toBe(1);
    expect(github.replyToReviewComment).toHaveBeenCalledWith(
      reference,
      "91",
      "Addressed in bbbbbbb.",
      "t",
    );
    expect(github.resolveReviewThread).toHaveBeenCalledWith("T1", "t");
  });

  it("says withdrawn rather than fixed for a withdrawn finding", async () => {
    expect(closingReply("withdrawn", "b".repeat(40), 3)).toBe("Withdrawn in round 3.");
    expect(closingReply("addressed", "b".repeat(40), 3)).toBe("Addressed in bbbbbbb.");
  });

  it("asks GitHub for nothing when no closed finding has a comment", async () => {
    const github = client([]);
    const closed = await closeFindingThreads(github, {
      reference,
      token: "t",
      headSha: "b".repeat(40),
      round: 2,
      closed: [{ stableId: "f1", status: "addressed", commentId: null }],
    });
    expect(closed).toBe(0);
    expect(github.reviewThreads).not.toHaveBeenCalled();
  });

  it("leaves a thread that is already resolved or unknown alone", async () => {
    const github = client([{ id: "T1", isResolved: true, commentIds: ["91"] }]);
    const closed = await closeFindingThreads(github, {
      reference,
      token: "t",
      headSha: "b".repeat(40),
      round: 2,
      closed: [
        { stableId: "f1", status: "addressed", commentId: "91" },
        { stableId: "f2", status: "withdrawn", commentId: "92" },
      ],
    });
    expect(closed).toBe(0);
    expect(github.replyToReviewComment).not.toHaveBeenCalled();
  });

  it("logs a failed close and goes on with the next one", async () => {
    const github = client([
      { id: "T1", isResolved: false, commentIds: ["91"] },
      { id: "T2", isResolved: false, commentIds: ["92"] },
    ]);
    (github.replyToReviewComment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("GitHub POST failed: 502"),
    );
    const lines: string[] = [];
    const closed = await closeFindingThreads(
      github,
      {
        reference,
        token: "t",
        headSha: "b".repeat(40),
        round: 2,
        closed: [
          { stableId: "f1", status: "addressed", commentId: "91" },
          { stableId: "f2", status: "addressed", commentId: "92" },
        ],
      },
      (line) => lines.push(line),
    );
    expect(closed).toBe(1);
    expect(lines).toEqual(["thread of finding f1 not closed: GitHub POST failed: 502"]);
    expect(github.resolveReviewThread).toHaveBeenCalledWith("T2", "t");
  });
});
