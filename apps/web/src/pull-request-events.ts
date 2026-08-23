import type { GitHubClient } from "@hawkeye/core";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, job, userSettings } from "./db/schema";
import type { PullRequestEvent } from "./github/webhook-events";
import { enqueueJob } from "./jobs";
import { quietWindowSeconds } from "./quiet-window";
import { resolveReviewTarget, type ReviewTarget } from "./review-target";

export type PullRequestEventResult = {
  enqueued: number;
  disarmed: number;
  cancelled: number;
  ignored?: string;
};

const REVIEW_ACTIONS = new Set(["synchronize", "ready_for_review"]);

function activeRows(event: PullRequestEvent) {
  return and(
    eq(armedPr.owner, event.repository.owner),
    eq(armedPr.repo, event.repository.name),
    eq(armedPr.number, event.number),
    isNull(armedPr.disarmedAt),
  );
}

export async function handlePullRequestEvent(
  deps: { db: Db; github: GitHubClient },
  event: PullRequestEvent,
): Promise<PullRequestEventResult> {
  const { db, github } = deps;

  if (event.action === "closed") {
    const disarmed = await db
      .update(armedPr)
      .set({ disarmedAt: sql`now()` })
      .where(activeRows(event))
      .returning({ id: armedPr.id });
    const cancelled = await db
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
    return { enqueued: 0, disarmed: disarmed.length, cancelled: cancelled.length };
  }

  if (!REVIEW_ACTIONS.has(event.action)) {
    return { enqueued: 0, disarmed: 0, cancelled: 0, ignored: event.action };
  }

  const armed = await db.select().from(armedPr).where(activeRows(event));
  const reference = {
    owner: event.repository.owner,
    repo: event.repository.name,
    number: event.number,
  };
  let target: Promise<ReviewTarget> | undefined;
  const reviewTarget = () =>
    (target ??= github.installationTokenById(event.installationId).then((token) =>
      resolveReviewTarget(github, {
        reference,
        headSha: event.headSha,
        baseSha: event.baseSha,
        token,
      }),
    ));
  let enqueued = 0;

  for (const row of armed) {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, row.userId));
    if (event.draft && !settings?.reviewDrafts) continue;

    const target = await reviewTarget();
    const delaySeconds = quietWindowSeconds(settings, row);
    await enqueueJob(db, {
      armedPrId: row.id,
      ...target,
      notBefore: new Date(Date.now() + delaySeconds * 1000),
    });
    enqueued += 1;
  }

  return { enqueued, disarmed: 0, cancelled: 0 };
}
