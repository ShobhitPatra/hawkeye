import type { GitHubClient } from "@hawkeye/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, job, userSettings } from "./db/schema";
import type { PullRequestEvent } from "./github/webhook-events";
import { armForAuthor } from "./auto-review";
import { enqueueJob } from "./jobs";
import { quietWindowSeconds } from "./quiet-window";
import { resolveReviewTarget, type ReviewTarget } from "./review-target";

export type PullRequestEventResult = {
  armed: number;
  enqueued: number;
  disarmed: number;
  cancelled: number;
  retitled?: number;
  ignored?: string;
};

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "ready_for_review"]);

function activeRows(event: PullRequestEvent) {
  return and(
    eq(armedPr.owner, event.repository.owner),
    eq(armedPr.repo, event.repository.name),
    eq(armedPr.number, event.number),
    isNull(armedPr.disarmedAt),
  );
}

async function storeTitle(db: Db, event: PullRequestEvent, title: string): Promise<number> {
  const rows = await db
    .update(armedPr)
    .set({ title })
    .where(and(activeRows(event), sql`${armedPr.title} is distinct from ${title}`))
    .returning({ id: armedPr.id });
  return rows.length;
}

export async function handlePullRequestEvent(
  deps: { db: Db; github: GitHubClient },
  event: PullRequestEvent,
): Promise<PullRequestEventResult> {
  const { db, github } = deps;

  if (event.action === "closed") {
    return db.transaction(async (tx) => {
      const disarmed = await tx
        .update(armedPr)
        .set({ disarmedAt: sql`now()` })
        .where(activeRows(event))
        .returning({ id: armedPr.id });
      const cancelled = await tx
        .delete(job)
        .where(
          and(
            inArray(
              job.armedPrId,
              disarmed.map((row) => row.id),
            ),
            eq(job.state, "queued"),
          ),
        )
        .returning({ id: job.id });
      return { armed: 0, enqueued: 0, disarmed: disarmed.length, cancelled: cancelled.length };
    });
  }

  if (event.action === "edited") {
    const retitled = await storeTitle(db, event, event.title);
    return { armed: 0, enqueued: 0, disarmed: 0, cancelled: 0, retitled };
  }

  if (!REVIEW_ACTIONS.has(event.action)) {
    return { armed: 0, enqueued: 0, disarmed: 0, cancelled: 0, ignored: event.action };
  }

  const newlyArmed = await armForAuthor(db, event);
  const armedCount = newlyArmed ? 1 : 0;

  const armed = await db.select().from(armedPr).where(activeRows(event));
  if (armed.length === 0) return { armed: armedCount, enqueued: 0, disarmed: 0, cancelled: 0 };

  const reference = {
    owner: event.repository.owner,
    repo: event.repository.name,
    number: event.number,
  };
  const token = await github.installationTokenById(event.installationId);
  const current = await github.pullRequest(reference, token);
  if (current.headSha !== event.headSha) {
    return { armed: armedCount, enqueued: 0, disarmed: 0, cancelled: 0, ignored: "stale head" };
  }
  await storeTitle(db, event, current.title);

  let pendingTarget: Promise<ReviewTarget> | undefined;
  const reviewTarget = () =>
    (pendingTarget ??= resolveReviewTarget(github, {
      reference,
      headSha: event.headSha,
      baseSha: event.baseSha,
      token,
    }));
  let enqueued = 0;

  for (const row of armed) {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, row.userId));
    if (event.draft && !settings?.reviewDrafts) continue;

    const target = await reviewTarget();
    const delaySeconds = quietWindowSeconds(settings, row);
    const queued = await enqueueJob(db, {
      armedPrId: row.id,
      ...target,
      headCurrentAt: new Date(event.updatedAt),
      notBefore: new Date(Date.now() + delaySeconds * 1000),
    });
    if (queued) enqueued += 1;
  }

  return { armed: armedCount, enqueued, disarmed: 0, cancelled: 0 };
}
