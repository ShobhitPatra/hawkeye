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

export const PULL_REQUEST_LIST_TTL_MS = 60_000;

type Listing = { pullRequests: ListedPullRequest[]; failures: InstallationFailure[] };
type ListingCache = Map<string, { at: number; listing: Promise<Listing> }>;
const listings: ListingCache = new Map();

export async function listUserOpenPullRequests(
  deps: { db: Db; github: GitHubClient; cache?: ListingCache },
  input: { userId: string; login: string; now?: number },
): Promise<Listing> {
  const cache = deps.cache ?? listings;
  const now = input.now ?? Date.now();
  const key = `${input.userId}:${input.login}`;
  const held = cache.get(key);
  if (held && now - held.at < PULL_REQUEST_LIST_TTL_MS) return held.listing;
  const listing = fetchUserOpenPullRequests(deps, input);
  cache.set(key, { at: now, listing });
  return listing;
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
