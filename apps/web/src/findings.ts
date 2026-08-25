import { type Finding, findingId } from "@hawkeye/core";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { finding } from "./db/schema";

export type RecordFindingsInput = { armedPrId: string; headSha: string; findings: Finding[] };
export type RecordedFindings = { created: number; updated: number; resolved: number };

export async function recordFindings(
  db: Db,
  input: RecordFindingsInput,
): Promise<RecordedFindings> {
  const { armedPrId, headSha } = input;
  const byStableId = new Map<string, Finding>();
  for (const entry of input.findings) {
    const stableId = findingId(entry.path, entry.claim);
    if (!byStableId.has(stableId)) byStableId.set(stableId, entry);
  }

  return db.transaction(async (tx) => {
    const counts: RecordedFindings = { created: 0, updated: 0, resolved: 0 };
    for (const [stableId, entry] of byStableId) {
      const [row] = await tx
        .insert(finding)
        .values({
          armedPrId,
          stableId,
          severity: entry.severity,
          claim: entry.claim,
          path: entry.path ?? null,
          line: entry.line ?? null,
          firstSeenSha: headSha,
        })
        .onConflictDoUpdate({
          target: [finding.armedPrId, finding.stableId],
          set: {
            severity: entry.severity,
            claim: entry.claim,
            path: entry.path ?? null,
            line: entry.line ?? null,
            resolvedSha: null,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      // Postgres leaves xmax at 0 on a freshly inserted row and sets it on one the conflict clause updated.
      if (!row) throw new Error(`failed to record finding ${stableId} for ${armedPrId}`);
      if (row.inserted) counts.created += 1;
      else counts.updated += 1;
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
