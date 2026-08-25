import { type Finding, findingId } from "@hawkeye/core";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { armedPr, finding, job } from "./db/schema";

export type RecordFindingsInput = {
  armedPrId: string;
  headSha: string;
  findings: Finding[];
  jobId: string;
};
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
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
    counts.resolved = resolved.length;
    return counts;
  });
}

async function supersededBy(tx: Transaction, armedPrId: string, jobId: string): Promise<boolean> {
  const [newer] = await tx
    .select({ id: job.id })
    .from(job)
    .where(
      and(
        eq(job.armedPrId, armedPrId),
        eq(job.state, "done"),
        sql`(${job.createdAt}, ${job.id}) > (select created_at, id from ${job} own where own.id = ${jobId})`,
      ),
    )
    .limit(1);
  return newer !== undefined;
}
