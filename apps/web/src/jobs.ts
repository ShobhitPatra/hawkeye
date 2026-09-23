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
  fromScratch?: boolean;
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
        fromScratch: sql`${job.fromScratch} or excluded.from_scratch`,
      },
      setWhere: sql`${job.headCurrentAt} <= excluded.head_current_at`,
    })
    .returning();
  return row;
}
