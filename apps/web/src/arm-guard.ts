import {
  GitHubRequestError,
  type GitHubClient,
  type PullRequestDetails,
  type PullRequestReference,
} from "@hawkeye/core";

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
      throw new Error(
        `pull request ${reference.owner}/${reference.repo}#${reference.number} is not reachable through installation ${installationId}`,
        { cause: error },
      );
    }
    throw error;
  }
}
