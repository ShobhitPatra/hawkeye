import type { GitHubClient } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import {
  HAWKEYE_STATUS_CONTEXT,
  reviewedDescription,
  reviewingDescription,
  setCommitStatus,
} from "./commit-status";

const target = {
  reference: { owner: "octo", repo: "repo", number: 7 },
  headSha: "a".repeat(40),
  token: "ghs_token",
};

describe("commit status", () => {
  it("names the runner while reviewing and the verdict with its count afterwards", () => {
    expect(reviewingDescription("laptop")).toBe("Reviewing on laptop");
    expect(reviewedDescription({ verdict: "changes_needed", findings: [] })).toBe(
      "Changes needed · 0 findings",
    );
    expect(
      reviewedDescription({
        verdict: "ship",
        findings: [{ severity: "optional", claim: "a", detail: "b" }],
      }),
    ).toBe("Ship · 1 finding");
  });

  it("posts the status under the hawkeye context and truncates long descriptions", async () => {
    const createCommitStatus = vi.fn(async () => {});
    await setCommitStatus(
      { createCommitStatus } as unknown as GitHubClient,
      target,
      "pending",
      "x".repeat(200),
    );
    expect(createCommitStatus).toHaveBeenCalledWith(
      target.reference,
      target.headSha,
      { state: "pending", description: "x".repeat(140), context: HAWKEYE_STATUS_CONTEXT },
      "ghs_token",
    );
  });

  it("logs and swallows a failure so a status never blocks a review", async () => {
    const log = vi.fn();
    const github = {
      createCommitStatus: vi.fn(async () => {
        throw new Error("Resource not accessible by integration");
      }),
    } as unknown as GitHubClient;
    await expect(setCommitStatus(github, target, "success", "done", log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      `commit status not set on ${"a".repeat(7)}: Resource not accessible by integration`,
    );
  });
});
