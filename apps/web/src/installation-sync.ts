import { and, eq } from "drizzle-orm";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { account } from "./db/schema";
import { createGitHubAppClient } from "./github/app";
import { type InstallationSync, syncUserInstallations } from "./installations";

export async function syncInstallationsForUser(
  userId: string,
  headers?: Headers,
): Promise<InstallationSync> {
  const db = getDb();
  const [githubAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github")));
  if (!githubAccount) throw new Error(`user ${userId} has no GitHub account`);
  const { accessToken } = await getAuth().api.getAccessToken({
    body: { accountId: githubAccount.id, userId },
    ...(headers ? { headers } : {}),
  });
  return syncUserInstallations(db, createGitHubAppClient({ fetch }), {
    userId,
    token: accessToken,
  });
}
