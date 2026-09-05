import { type Finding, findingId, type PriorFindingReport } from "@hawkeye/core";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./db/client";
import { armedPr, finding, job } from "./db/schema";

export type RecordFindingsInput = {
  armedPrId: string;
  headSha: string;
  findings: Finding[];
  priorFindings?: PriorFindingReport[];
  jobId: string;
};
export type RecordedFindings = { created: number; updated: number; resolved: number };

export async function recordFindings(
  db: Db,
  input: RecordFindingsInput,
): Promise<RecordedFindings | "superseded"> {
  const { armedPrId, headSha } = input;
  const byStableId = new Map<string, Finding>();
  for (const entry of input.findings) {
    const stableId = findingId(entry.path, entry.claim);
    if (!byStableId.has(stableId)) byStableId.set(stableId, entry);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from ${armedPr} where ${armedPr.id} = ${armedPrId} for update`);
    if (await supersededBy(tx, armedPrId, input.jobId)) return "superseded";
    const counts: RecordedFindings = { created: 0, updated: 0, resolved: 0 };
    if (byStableId.size > 0) {
      const rows = await tx
        .insert(finding)
        .values(
          [...byStableId].map(([stableId, entry]) => ({
            armedPrId,
            stableId,
            severity: entry.severity,
            claim: entry.claim,
            detail: entry.detail,
            path: entry.path ?? null,
            line: entry.line ?? null,
            firstSeenSha: headSha,
          })),
        )
        .onConflictDoUpdate({
          target: [finding.armedPrId, finding.stableId],
          set: {
            severity: sql`excluded.severity`,
            claim: sql`excluded.claim`,
            detail: sql`excluded.detail`,
            path: sql`excluded.path`,
            line: sql`excluded.line`,
            resolvedSha: null,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      // Postgres leaves xmax at 0 on a freshly inserted row and sets it on one the conflict clause updated.
      for (const row of rows) {
        if (row.inserted) counts.created += 1;
        else counts.updated += 1;
      }
    }

    const reportedClosed = (input.priorFindings ?? [])
      .filter((prior) => prior.status !== "open")
      .map((prior) => prior.id);
    if (reportedClosed.length > 0) {
      const closed = await tx
        .update(finding)
        .set({ resolvedSha: headSha })
        .where(
          and(
            eq(finding.armedPrId, armedPrId),
            isNull(finding.resolvedSha),
            inArray(finding.stableId, reportedClosed),
          ),
        )
        .returning({ id: finding.id });
      counts.resolved += closed.length;
    }

    const stableIds = [...byStableId.keys()];
    const resolved = await tx
      .update(finding)
      .set({ resolvedSha: headSha })
      .where(
        and(
          eq(finding.armedPrId, armedPrId),
          isNull(finding.resolvedSha),
          ...(stableIds.length ? [notInArray(finding.stableId, stableIds)] : []),
        ),
      )
      .returning({ id: finding.id });
    counts.resolved += resolved.length;
    return counts;
  });
}

async function supersededBy(db: Db, armedPrId: string, jobId: string): Promise<boolean> {
  const own = alias(job, "own");
  const [newer] = await db
    .select({ id: job.id })
    .from(job)
    .innerJoin(own, eq(own.id, jobId))
    .where(
      and(
        eq(job.armedPrId, armedPrId),
        eq(job.state, "done"),
        sql`(${job.createdAt}, ${job.id}) > (${own.createdAt}, ${own.id})`,
      ),
    )
    .limit(1);
  return newer !== undefined;
}
