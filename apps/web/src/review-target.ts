import type { GitHubClient, PullRequestReference } from "@hawkeye/core";

export type ReviewTarget = { headSha: string; baseSha: string };

export async function resolveReviewTarget(
  github: GitHubClient,
  input: { reference: PullRequestReference; headSha: string; baseSha: string; token: string },
): Promise<ReviewTarget> {
  const mergeBase = await github.mergeBase(
    input.reference,
    input.baseSha,
    input.headSha,
    input.token,
  );
  return { headSha: input.headSha, baseSha: mergeBase };
}
