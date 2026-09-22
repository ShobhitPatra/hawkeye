import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { job } from "./db/schema";

export type Job = typeof job.$inferSelect;

export type EnqueueJobInput = {
  armedPrId: string;
  headSha: string;
  baseSha: string;
  headCurrentAt: Date;
  notBefore: Date;
};

export async function enqueueJob(db: Db, input: EnqueueJobInput): Promise<Job | undefined> {
  const [row] = await db
    .insert(job)
    .values(input)
    .onConflictDoUpdate({
      target: job.armedPrId,
      targetWhere: sql`state = 'queued'`,
      set: {
        headSha: input.headSha,
        baseSha: input.baseSha,
        headCurrentAt: input.headCurrentAt,
        notBefore: input.notBefore,
      },
      setWhere: sql`${job.headCurrentAt} <= excluded.head_current_at`,
    })
    .returning();
  return row;
}
