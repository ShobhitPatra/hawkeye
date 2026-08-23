import { GitHubRequestError, type GitHubClient } from "@hawkeye/core";

export async function assertPullRequestInInstallation(
  github: GitHubClient,
  installationId: string,
  reference: { owner: string; repo: string; number: number },
): Promise<void> {
  const token = await github.installationTokenById(installationId);
  try {
    await github.pullRequest(reference, token);
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
