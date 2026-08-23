import type { GitHubClient, OpenPullRequest } from "@hawkeye/core";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { installation, installationUser } from "./db/schema";

export async function listUserOpenPullRequests(
  deps: { db: Db; github: GitHubClient },
  input: { userId: string; login: string },
): Promise<OpenPullRequest[]> {
  const installations = await deps.db
    .select({ id: installation.id })
    .from(installation)
    .innerJoin(installationUser, eq(installationUser.installationId, installation.id))
    .where(and(eq(installationUser.userId, input.userId), isNull(installation.deletedAt)))
    .orderBy(installation.id);

  const pullRequests: OpenPullRequest[] = [];
  for (const { id } of installations) {
    const token = await deps.github.installationTokenById(id);
    const repositories = await deps.github.listInstallationRepositories(token);
    pullRequests.push(
      ...(await deps.github.listOpenPullRequestsByAuthor(token, repositories, input.login)),
    );
  }

  return pullRequests.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
