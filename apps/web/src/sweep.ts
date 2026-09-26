import { timingSafeEqual } from "node:crypto";
import type { GitHubClient } from "@hawkeye/core";
import { NOT_COMPLETED_DESCRIPTION, setCommitStatus } from "./commit-status";
import type { Db } from "./db/client";
import { type FailedStaleJob, newerRunIsLive, requeueStaleJobs } from "./job-queue";
import { livingReviewFor } from "./review-posting";
import { clearReviewing, NOT_COMPLETED_BODY } from "./reviewing-line";

export type StaleSweepDeps = {
  db: Db;
  github: GitHubClient;
  log?: (line: string) => void;
};

export type SweepDeps = StaleSweepDeps & {
  secret: string | undefined;
  now?: () => Date;
};

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function sweep(request: Request, deps: SweepDeps): Promise<Response> {
  if (!authorized(request, deps.secret)) {
    if (!deps.secret) deps.log?.("sweep refused: CRON_SECRET is not set, so no caller can sweep");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await sweepStaleJobs(deps, { now: (deps.now ?? (() => new Date()))() });
  return Response.json({ ok: true, swept }, { status: 200 });
}

export async function sweepStaleJobs(
  deps: StaleSweepDeps,
  input: { now: Date; userId?: string },
): Promise<number> {
  const { swept, failed } = await requeueStaleJobs(deps.db, input);
  for (const job of failed) await closeOnGitHub(deps, job);
  return swept;
}

async function closeOnGitHub(deps: StaleSweepDeps, failed: FailedStaleJob): Promise<void> {
  const { owner, repo, number } = failed.armedPr;
  const reference = { owner, repo, number };
  try {
    const token = await deps.github.installationTokenById(failed.armedPr.installationId);
    await setCommitStatus(
      deps.github,
      { reference, headSha: failed.headSha, token },
      "success",
      NOT_COMPLETED_DESCRIPTION,
      deps.log,
    );
    const living = await livingReviewFor(deps.db, failed.armedPr);
    await clearReviewing(deps, {
      reference,
      headSha: failed.headSha,
      token,
      runId: failed.runId,
      livingReviewId: living?.githubReviewId,
      placeholderReviewId: failed.placeholderReviewId,
      closing: NOT_COMPLETED_BODY,
      livingBlockBelongsToNewerRun: () =>
        newerRunIsLive(deps.db, { jobId: failed.jobId, armedPrId: failed.armedPr.id }),
    });
  } catch (error) {
    deps.log?.(
      `swept job ${failed.jobId} not closed on GitHub: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
