import {
  type GitHubClient,
  type PullRequestReference,
  type ReviewResult,
  VERDICT_LABELS,
} from "@hawkeye/core";

export const HAWKEYE_STATUS_CONTEXT = "hawkeye";
const MAX_DESCRIPTION_LENGTH = 140;

export type CommitStatusTarget = {
  reference: PullRequestReference;
  headSha: string;
  token: string | (() => Promise<string>);
};

export function reviewingDescription(runnerName: string): string {
  return `Reviewing on ${runnerName}`;
}

export function reviewedDescription(result: Pick<ReviewResult, "verdict" | "findings">): string {
  const count = result.findings.length;
  return `${VERDICT_LABELS[result.verdict]} · ${count} finding${count === 1 ? "" : "s"}`;
}

export const NOT_COMPLETED_DESCRIPTION = "Review did not complete";
export const SUPERSEDED_DESCRIPTION = "Superseded by a newer push";

export async function setCommitStatus(
  github: Pick<GitHubClient, "createCommitStatus">,
  target: CommitStatusTarget,
  state: "pending" | "success",
  description: string,
  log?: (message: string) => void,
): Promise<void> {
  try {
    const token = typeof target.token === "string" ? target.token : await target.token();
    await github.createCommitStatus(
      target.reference,
      target.headSha,
      {
        state,
        description: description.slice(0, MAX_DESCRIPTION_LENGTH),
        context: HAWKEYE_STATUS_CONTEXT,
      },
      token,
    );
  } catch (error) {
    log?.(
      `commit status not set on ${target.headSha.slice(0, 7)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
