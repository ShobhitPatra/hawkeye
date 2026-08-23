import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { account, installation, installationUser } from "./db/schema";
import type { WebhookEvent } from "./github/webhook-events";

type InstallationEvent = Extract<WebhookEvent, { type: "installation" }>;

export async function linkInstallationToUser(
  db: Db,
  installationId: string,
  senderGitHubId: number,
) {
  const [linkedAccount] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "github"), eq(account.accountId, String(senderGitHubId))));
  if (!linkedAccount) return;

  await db
    .insert(installationUser)
    .values({ installationId, userId: linkedAccount.userId })
    .onConflictDoNothing();
}

export async function recordInstallation(db: Db, event: InstallationEvent) {
  const id = String(event.installation.id);
  const accountLogin = event.installation.account.login;
  const accountType = event.installation.account.type;

  if (event.action === "deleted" || event.action === "suspend") {
    await db.update(installation).set({ deletedAt: new Date() }).where(eq(installation.id, id));
    return;
  }

  await db
    .insert(installation)
    .values({ id, accountLogin, accountType, deletedAt: null })
    .onConflictDoUpdate({
      target: installation.id,
      set: { accountLogin, accountType, deletedAt: null },
    });
  await linkInstallationToUser(db, id, event.sender.id);
}
