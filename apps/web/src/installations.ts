import type { GitHubClient } from "@hawkeye/core";
import { and, eq, isNull, notInArray } from "drizzle-orm";
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

export async function installationBelongsToUser(
  db: Db,
  installationId: string,
  userId: string,
): Promise<boolean> {
  const [link] = await db
    .select({ userId: installationUser.userId })
    .from(installationUser)
    .innerJoin(installation, eq(installation.id, installationUser.installationId))
    .where(
      and(
        eq(installationUser.installationId, installationId),
        eq(installationUser.userId, userId),
        isNull(installation.deletedAt),
      ),
    );
  return link !== undefined;
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

export type InstallationSync = { linked: number; unlinked: number };

export async function syncUserInstallations(
  db: Db,
  github: Pick<GitHubClient, "listUserInstallations">,
  input: { userId: string; token: string },
): Promise<InstallationSync> {
  const accessible = await github.listUserInstallations(input.token);
  const ids = accessible.map((entry) => entry.id);
  return db.transaction(async (tx) => {
    for (const entry of accessible) {
      await tx
        .insert(installation)
        .values({
          id: entry.id,
          accountLogin: entry.accountLogin,
          accountType: entry.accountType,
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: installation.id,
          set: {
            accountLogin: entry.accountLogin,
            accountType: entry.accountType,
            deletedAt: null,
          },
        });
    }
    const linked =
      ids.length === 0
        ? []
        : await tx
            .insert(installationUser)
            .values(ids.map((installationId) => ({ installationId, userId: input.userId })))
            .onConflictDoNothing()
            .returning({ installationId: installationUser.installationId });
    const unlinked = await tx
      .delete(installationUser)
      .where(
        and(
          eq(installationUser.userId, input.userId),
          ...(ids.length === 0 ? [] : [notInArray(installationUser.installationId, ids)]),
        ),
      )
      .returning({ installationId: installationUser.installationId });
    return { linked: linked.length, unlinked: unlinked.length };
  });
}
