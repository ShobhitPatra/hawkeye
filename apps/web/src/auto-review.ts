import { and, eq } from "drizzle-orm";
import { type ArmedPullRequest, armPullRequest } from "./arming";
import type { Db } from "./db/client";
import { account, armedPr, installationUser, userSettings } from "./db/schema";
import type { PullRequestEvent } from "./github/webhook-events";

const ARMING_ACTIONS = new Set(["opened", "ready_for_review"]);

export async function armForAuthor(
  db: Db,
  event: PullRequestEvent,
): Promise<ArmedPullRequest | undefined> {
  if (!ARMING_ACTIONS.has(event.action)) return undefined;

  const [author] = await db
    .select({ userId: account.userId })
    .from(account)
    .innerJoin(
      installationUser,
      and(
        eq(installationUser.userId, account.userId),
        eq(installationUser.installationId, event.installationId),
      ),
    )
    .where(and(eq(account.providerId, "github"), eq(account.accountId, event.authorId)));
  if (!author) return undefined;
  const [settings] = await db
    .select({ autoReview: userSettings.autoReview, reviewDrafts: userSettings.reviewDrafts })
    .from(userSettings)
    .where(eq(userSettings.userId, author.userId));
  if (settings && !settings.autoReview) return undefined;
  if (event.draft && !settings?.reviewDrafts) return undefined;

  const reference = {
    owner: event.repository.owner,
    repo: event.repository.name,
    number: event.number,
  };
  const [known] = await db
    .select({ id: armedPr.id })
    .from(armedPr)
    .where(
      and(
        eq(armedPr.userId, author.userId),
        eq(armedPr.owner, reference.owner),
        eq(armedPr.repo, reference.repo),
        eq(armedPr.number, reference.number),
      ),
    );
  if (known) return undefined;

  return armPullRequest(db, {
    ...reference,
    userId: author.userId,
    installationId: event.installationId,
  });
}
