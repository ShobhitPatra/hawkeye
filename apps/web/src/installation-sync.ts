import type { GitHubClient } from "@hawkeye/core";
import { and, eq } from "drizzle-orm";
import type { getAuth } from "./auth";
import type { Db } from "./db/client";
import { account } from "./db/schema";
import { type InstallationSync, syncUserInstallations } from "./installations";
import { forgetUserListings } from "./pull-requests";

export type InstallationSyncDeps = {
  auth: Pick<ReturnType<typeof getAuth>, "api">;
  db: Db;
  github: Pick<GitHubClient, "listUserInstallations">;
};

export async function syncInstallationsForUser(
  deps: InstallationSyncDeps,
  userId: string,
  headers?: Headers,
): Promise<InstallationSync> {
  const [githubAccount] = await deps.db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")));
  if (!githubAccount) throw new Error(`user ${userId} has no GitHub account`);
  const { accessToken } = await deps.auth.api.getAccessToken({
    body: { accountId: githubAccount.id, userId },
    ...(headers ? { headers } : {}),
  });
  const synced = await syncUserInstallations(deps.db, deps.github, { userId, token: accessToken });
  if (synced.linked > 0 || synced.unlinked > 0) forgetUserListings(userId);
  return synced;
}
