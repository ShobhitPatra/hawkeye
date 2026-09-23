import type { PullRequestReference } from "@hawkeye/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr } from "./db/schema";

export type ArmedPullRequest = typeof armedPr.$inferSelect;

export function armedPullRequestKey(pullRequest: PullRequestReference) {
  return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;
}

function activeRow(userId: string, pullRequest: PullRequestReference) {
  return and(
    eq(armedPr.userId, userId),
    eq(armedPr.owner, pullRequest.owner),
    eq(armedPr.repo, pullRequest.repo),
    eq(armedPr.number, pullRequest.number),
    isNull(armedPr.disarmedAt),
  );
}

export async function armPullRequest(
  db: Db,
  input: PullRequestReference & { userId: string; installationId: string; title: string },
): Promise<ArmedPullRequest> {
  const [inserted] = await db
    .insert(armedPr)
    .values({
      userId: input.userId,
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
      title: input.title,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [existing] = await db.select().from(armedPr).where(activeRow(input.userId, input));
  if (!existing) throw new Error(`${armedPullRequestKey(input)} was disarmed while arming`);
  if (existing.installationId === input.installationId && existing.title === input.title)
    return existing;

  const [updated] = await db
    .update(armedPr)
    .set({ installationId: input.installationId, title: input.title })
    .where(eq(armedPr.id, existing.id))
    .returning();
  if (!updated) throw new Error(`${armedPullRequestKey(input)} was disarmed while arming`);
  return updated;
}

export async function disarmPullRequest(
  db: Db,
  input: PullRequestReference & { userId: string },
): Promise<ArmedPullRequest | undefined> {
  const [disarmed] = await db
    .update(armedPr)
    .set({ disarmedAt: sql`now()` })
    .where(activeRow(input.userId, input))
    .returning();
  return disarmed;
}
