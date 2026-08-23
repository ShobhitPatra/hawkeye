import { sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { job } from "./db/schema";

export type Job = typeof job.$inferSelect;

export type EnqueueJobInput = {
  armedPrId: string;
  headSha: string;
  baseSha: string;
  notBefore: Date;
};

export async function enqueueJob(db: Db, input: EnqueueJobInput): Promise<Job> {
  const [row] = await db
    .insert(job)
    .values(input)
    .onConflictDoUpdate({
      target: job.armedPrId,
      targetWhere: sql`state = 'queued'`,
      set: {
        headSha: input.headSha,
        baseSha: input.baseSha,
        notBefore: input.notBefore,
      },
    })
    .returning();
  if (!row) throw new Error(`failed to enqueue a job for armed pull request ${input.armedPrId}`);
  return row;
}
