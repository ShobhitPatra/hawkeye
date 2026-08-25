import {
  type ClaimedJob,
  type GitHubClient,
  RUN_RESULT_STATUSES,
  parseReviewResult,
  type RunEvent,
  type RunResultReport,
  type RunResultStatus,
} from "@hawkeye/core";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  armedPr,
  DEFAULT_MAX_TURNS,
  DEFAULT_WALL_CLOCK_MINUTES,
  job,
  run,
  userSettings,
} from "./db/schema";
import {
  claimNextJob,
  completeRun,
  createRun,
  heartbeatJob,
  holdsJobClaim,
  releaseJob,
  requeueStaleJobs,
} from "./job-queue";
import { postReviewForRun } from "./review-posting";
import { requireRunner } from "./runner-auth";

export const DEFAULT_CLAIM_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_CLAIM_POLL_TOTAL_MS = 25_000;

export type ClaimDeps = {
  db: Db;
  github: GitHubClient;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  poll?: { intervalMs: number; totalMs: number };
};

export type RunnerApiDeps = { db: Db };
export type RecordResultDeps = RunnerApiDeps & {
  github: GitHubClient;
  log?: (line: string) => void;
};

function claimLost(): Response {
  return Response.json({ error: "job is no longer claimed by this runner" }, { status: 409 });
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function settingsFor(db: Db, userId: string): Promise<ClaimedJob["settings"]> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    maxTurns: row?.maxTurns ?? DEFAULT_MAX_TURNS,
    wallClockMinutes: row?.wallClockMinutes ?? DEFAULT_WALL_CLOCK_MINUTES,
    ...(row?.promptOverride ? { promptOverride: row.promptOverride } : {}),
  };
}

export async function claimJob(request: Request, deps: ClaimDeps): Promise<Response> {
  const runner = await requireRunner(request, deps.db);
  if (runner instanceof Response) return runner;

  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? sleepFor;
  const { intervalMs, totalMs } = deps.poll ?? {
    intervalMs: DEFAULT_CLAIM_POLL_INTERVAL_MS,
    totalMs: DEFAULT_CLAIM_POLL_TOTAL_MS,
  };
  const deadline = now().getTime() + totalMs;
  await requeueStaleJobs(deps.db, { now: now() });

  for (;;) {
    const claimed = await claimNextJob(deps.db, {
      runnerId: runner.id,
      userId: runner.userId,
      now: now(),
    });
    if (claimed) {
      const [armed] = await deps.db.select().from(armedPr).where(eq(armedPr.id, claimed.armedPrId));
      if (!armed) throw new Error(`job ${claimed.id} has no armed pull request`);

      const created = await createRun(deps.db, { jobId: claimed.id, runnerId: runner.id });
      let installationToken: string;
      try {
        installationToken = await deps.github.installationTokenById(armed.installationId);
      } catch {
        await releaseJob(deps.db, {
          jobId: claimed.id,
          runId: created.id,
          runnerId: runner.id,
          error: "installation token",
          now: now(),
        });
        return Response.json({ error: "installation token" }, { status: 500 });
      }
      const body: ClaimedJob = {
        job: {
          id: claimed.id,
          runId: created.id,
          headSha: claimed.headSha,
          baseSha: claimed.baseSha,
        },
        pullRequest: { owner: armed.owner, repo: armed.repo, number: armed.number },
        installationToken,
        settings: await settingsFor(deps.db, runner.userId),
      };
      return Response.json(body, { status: 200 });
    }

    if (now().getTime() + intervalMs >= deadline) return new Response(null, { status: 204 });
    await sleep(intervalMs);
  }
}

export async function heartbeat(
  request: Request,
  deps: RunnerApiDeps,
  jobId: string,
): Promise<Response> {
  const runner = await requireRunner(request, deps.db);
  if (runner instanceof Response) return runner;

  const beat = await heartbeatJob(deps.db, { jobId, runnerId: runner.id, now: new Date() });
  if (!beat) {
    const [existing] = await deps.db.select().from(job).where(eq(job.id, jobId));
    if (!existing) return Response.json({ error: "job not found" }, { status: 404 });
    return claimLost();
  }
  return Response.json({ ok: true }, { status: 200 });
}

function parseEvents(payload: unknown): RunEvent[] {
  if (!Array.isArray(payload)) throw new Error("events must be an array");
  return payload.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw new Error("an event must be an object");
    const { type, at, data } = entry as Record<string, unknown>;
    if (typeof type !== "string" || !type) throw new Error("an event needs a type");
    if (typeof at !== "string" || !at) throw new Error("an event needs an at timestamp");
    return { type, at, data };
  });
}

export async function recordEvents(
  request: Request,
  deps: RunnerApiDeps,
  runId: string,
): Promise<Response> {
  const runner = await requireRunner(request, deps.db);
  if (runner instanceof Response) return runner;

  let events: RunEvent[];
  try {
    events = parseEvents(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid events" },
      { status: 400 },
    );
  }

  if (!(await holdsJobClaim(deps.db, { runId, runnerId: runner.id }))) {
    const [owned] = await deps.db
      .select({ id: run.id })
      .from(run)
      .where(and(eq(run.id, runId), eq(run.runnerId, runner.id)));
    if (!owned) return Response.json({ error: "run not found" }, { status: 404 });
    return claimLost();
  }

  const turns = events.filter((event) => event.type === "turn").length;
  const [updated] = await deps.db
    .update(run)
    .set({ turns: sql`${run.turns} + ${turns}` })
    .where(and(eq(run.id, runId), eq(run.runnerId, runner.id)))
    .returning();
  if (!updated) return Response.json({ error: "run not found" }, { status: 404 });
  return Response.json({ ok: true, turns: updated.turns }, { status: 200 });
}

function isRunResultStatus(value: unknown): value is RunResultStatus {
  return RUN_RESULT_STATUSES.includes(value as RunResultStatus);
}

function parseRunResultReport(payload: unknown): RunResultReport {
  if (typeof payload !== "object" || payload === null)
    throw new Error("a result must be an object");
  const { status, turns, result, error, commentable } = payload as Record<string, unknown>;
  if (!isRunResultStatus(status))
    throw new Error(`status must be one of ${RUN_RESULT_STATUSES.join(", ")}`);
  if (!Number.isInteger(turns) || (turns as number) < 0)
    throw new Error("turns must be a non-negative integer");
  if (result !== undefined && (typeof result !== "object" || result === null))
    throw new Error("result must be an object");
  if (status === "ok" && !result) throw new Error("an ok result needs a review result");
  if (error !== undefined && typeof error !== "string") throw new Error("error must be a string");
  return {
    status,
    turns: turns as number,
    ...(status === "ok" ? { result: parseReviewResult(result) } : {}),
    ...(error ? { error: error as string } : {}),
    ...(commentable === undefined ? {} : { commentable: parseCommentable(commentable) }),
  };
}

function parseCommentable(payload: unknown): Record<string, number[]> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Error("commentable must be an object of line arrays");
  for (const lines of Object.values(payload as Record<string, unknown>)) {
    if (
      !Array.isArray(lines) ||
      !lines.every((line) => Number.isInteger(line) && (line as number) >= 0)
    )
      throw new Error("commentable lines must be arrays of non-negative integers");
  }
  return payload as Record<string, number[]>;
}

export async function recordResult(
  request: Request,
  deps: RecordResultDeps,
  runId: string,
): Promise<Response> {
  const runner = await requireRunner(request, deps.db);
  if (runner instanceof Response) return runner;

  let report: RunResultReport;
  try {
    report = parseRunResultReport(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid result" },
      { status: 400 },
    );
  }

  const [existing] = await deps.db
    .select()
    .from(run)
    .where(and(eq(run.id, runId), eq(run.runnerId, runner.id)));
  if (!existing) return Response.json({ error: "run not found" }, { status: 404 });
  if (existing.status !== "running")
    return Response.json({ error: "run is already complete" }, { status: 409 });

  const completed = await completeRun(deps.db, { runId, runnerId: runner.id, ...report });
  if (!completed) return claimLost();
  const { result } = report;
  if (report.status !== "ok" || !result) return Response.json({ ok: true }, { status: 200 });

  const [target] = await deps.db
    .select({ headSha: job.headSha, armedPr })
    .from(job)
    .innerJoin(armedPr, eq(armedPr.id, job.armedPrId))
    .where(eq(job.id, completed.jobId));
  if (!target) throw new Error(`run ${runId} has no armed pull request`);
  const posted = await postReviewForRun(deps, {
    runId,
    armedPr: target.armedPr,
    headSha: target.headSha,
    result,
    commentable: report.commentable ?? {},
  });
  return Response.json({ ok: true, posted }, { status: 200 });
}
