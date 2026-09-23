import type { GitHubClient, PriorFindingStatus, PullRequestReference } from "@hawkeye/core";

export type ClosedFinding = {
  stableId: string;
  status: Exclude<PriorFindingStatus, "open">;
  commentId: string | null;
};

export function closingReply(status: ClosedFinding["status"], headSha: string, round: number) {
  return status === "addressed"
    ? `Addressed in ${headSha.slice(0, 7)}.`
    : `Withdrawn in round ${round}.`;
}

export async function closeFindingThreads(
  github: GitHubClient,
  input: {
    reference: PullRequestReference;
    token: string;
    headSha: string;
    round: number;
    closed: ClosedFinding[];
  },
  log: (line: string) => void = () => {},
): Promise<number> {
  const withComment = input.closed.filter(
    (finding): finding is ClosedFinding & { commentId: string } => finding.commentId !== null,
  );
  if (withComment.length === 0) return 0;
  const threads = await github.reviewThreads(input.reference, input.token);
  const threadOf = new Map<string, (typeof threads)[number]>();
  for (const thread of threads) for (const id of thread.commentIds) threadOf.set(id, thread);
  let closed = 0;
  for (const finding of withComment) {
    const thread = threadOf.get(finding.commentId);
    if (thread === undefined || thread.isResolved) continue;
    try {
      await github.replyToReviewComment(
        input.reference,
        finding.commentId,
        closingReply(finding.status, input.headSha, input.round),
        input.token,
      );
      await github.resolveReviewThread(thread.id, input.token);
      closed += 1;
    } catch (error) {
      log(
        `thread of finding ${finding.stableId} not closed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return closed;
}
