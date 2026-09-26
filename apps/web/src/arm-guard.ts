import {
  GitHubRequestError,
  type GitHubClient,
  type PullRequestDetails,
  type PullRequestReference,
} from "@hawkeye/core";

export class PullRequestRefusedError extends Error {}

export async function assertPullRequestInInstallation(
  github: GitHubClient,
  installationId: string,
  reference: PullRequestReference,
): Promise<{ token: string; pullRequest: PullRequestDetails }> {
  const token = await github.installationTokenById(installationId);
  try {
    const pullRequest = await github.pullRequest(reference, token);
    return { token, pullRequest };
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) {
      throw new PullRequestRefusedError(
        `pull request ${reference.owner}/${reference.repo}#${reference.number} is not reachable through installation ${installationId}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function assertAuthoredBy(
  pullRequest: PullRequestDetails,
  login: string | null | undefined,
): void {
  if (!login || pullRequest.author.toLowerCase() !== login.toLowerCase()) {
    throw new PullRequestRefusedError(
      `pull request #${pullRequest.number} was opened by ${pullRequest.author}, not by the signed-in user`,
    );
  }
}
