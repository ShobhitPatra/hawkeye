import type { GitHubClient, OpenPullRequest } from "@hawkeye/core";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { installation, installationUser } from "./db/schema";

export interface ListedPullRequest extends OpenPullRequest {
  installationId: string;
}

export interface InstallationFailure {
  installationId: string;
  message: string;
}

export async function listUserOpenPullRequests(
  deps: { db: Db; github: GitHubClient },
  input: { userId: string; login: string },
): Promise<{ pullRequests: ListedPullRequest[]; failures: InstallationFailure[] }> {
  const installations = await deps.db
    .select({ id: installation.id })
    .from(installation)
    .innerJoin(installationUser, eq(installationUser.installationId, installation.id))
    .where(and(eq(installationUser.userId, input.userId), isNull(installation.deletedAt)))
    .orderBy(installation.id);

  const pullRequests: ListedPullRequest[] = [];
  const failures: InstallationFailure[] = [];
  for (const { id } of installations) {
    try {
      const token = await deps.github.installationTokenById(id);
      const repositories = await deps.github.listInstallationRepositories(token);
      const found = await deps.github.listOpenPullRequestsByAuthor(
        token,
        repositories,
        input.login,
      );
      pullRequests.push(...found.map((pullRequest) => ({ ...pullRequest, installationId: id })));
    } catch (error) {
      failures.push({
        installationId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    pullRequests: pullRequests.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    failures,
  };
}
