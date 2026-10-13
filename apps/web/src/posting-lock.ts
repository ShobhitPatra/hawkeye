import type { PullRequestReference } from "@hawkeye/core";
import { sql } from "drizzle-orm";
import type { Db } from "./db/client";

export async function lockPullRequest(db: Db, pullRequest: PullRequestReference): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${pullRequest.owner}/${pullRequest.repo}#${pullRequest.number}`}, 0))`,
  );
}
