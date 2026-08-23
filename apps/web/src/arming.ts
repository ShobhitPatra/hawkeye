import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr } from "./db/schema";

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export type ArmedPullRequest = typeof armedPr.$inferSelect;

export function armedPullRequestKey(pullRequest: PullRequestRef) {
  return `${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`;
}

function activeRow(userId: string, pullRequest: PullRequestRef) {
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
  input: PullRequestRef & { userId: string; installationId: string },
): Promise<ArmedPullRequest> {
  const [inserted] = await db
    .insert(armedPr)
    .values({
      userId: input.userId,
      installationId: input.installationId,
      owner: input.owner,
      repo: input.repo,
      number: input.number,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [existing] = await db.select().from(armedPr).where(activeRow(input.userId, input));
  if (!existing) throw new Error(`${armedPullRequestKey(input)} was disarmed while arming`);
  return existing;
}

export async function disarmPullRequest(
  db: Db,
  input: PullRequestRef & { userId: string },
): Promise<ArmedPullRequest | undefined> {
  const [disarmed] = await db
    .update(armedPr)
    .set({ disarmedAt: sql`now()` })
    .where(activeRow(input.userId, input))
    .returning();
  return disarmed;
}

export async function listArmedPullRequests(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ owner: armedPr.owner, repo: armedPr.repo, number: armedPr.number })
    .from(armedPr)
    .where(and(eq(armedPr.userId, userId), isNull(armedPr.disarmedAt)));
  return new Set(rows.map(armedPullRequestKey));
}
