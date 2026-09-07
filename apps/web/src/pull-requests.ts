import type { GitHubClient, OpenPullRequest } from "@hawkeye/core";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client";
import { hold, type HoldStore } from "./hold";
import { installation, installationUser } from "./db/schema";

export interface ListedPullRequest extends OpenPullRequest {
  installationId: string;
}

export interface InstallationFailure {
  installationId: string;
  message: string;
}

export const PULL_REQUEST_LIST_TTL_MS = 60_000;
export const FAILED_LIST_TTL_MS = 15_000;

type Listing = { pullRequests: ListedPullRequest[]; failures: InstallationFailure[] };
const listings: HoldStore<Listing> = new Map();

export async function listUserOpenPullRequests(
  deps: { db: Db; github: GitHubClient; cache?: HoldStore<Listing> },
  input: { userId: string; login: string; now?: number },
): Promise<Listing> {
  return hold(
    deps.cache ?? listings,
    `${input.userId}:${input.login}`,
    {
      now: input.now ?? Date.now(),
      ttlMs: PULL_REQUEST_LIST_TTL_MS,
      ttlAfter: (listing) =>
        listing.failures.length > 0 ? FAILED_LIST_TTL_MS : PULL_REQUEST_LIST_TTL_MS,
    },
    () => fetchUserOpenPullRequests(deps, input),
  );
}

async function fetchUserOpenPullRequests(
  deps: { db: Db; github: GitHubClient },
  input: { userId: string; login: string },
): Promise<Listing> {
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
