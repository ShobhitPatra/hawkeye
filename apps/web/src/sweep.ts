import { timingSafeEqual } from "node:crypto";
import type { Db } from "./db/client";
import { requeueStaleJobs } from "./job-queue";

export type SweepDeps = { db: Db; secret: string | undefined; now?: () => Date };

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const presented = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function sweep(request: Request, deps: SweepDeps): Promise<Response> {
  if (!authorized(request, deps.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const swept = await requeueStaleJobs(deps.db, { now: (deps.now ?? (() => new Date()))() });
  return Response.json({ ok: true, swept }, { status: 200 });
}
