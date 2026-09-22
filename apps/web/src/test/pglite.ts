import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import { enqueueJob, type EnqueueJobInput, type Job } from "../jobs";

const migrationsFolder = join(import.meta.dirname, "..", "..", "drizzle");

let shared: { db: Db; tables: string[] } | undefined;

// Vitest gives every test file its own module instance, so this is one database per file.
export async function createTestDb(): Promise<Db> {
  if (shared) {
    await shared.db.execute(
      sql.raw(`truncate table ${shared.tables.map((name) => `"${name}"`).join(", ")} cascade`),
    );
    return shared.db;
  }
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  shared = { db, tables: rows.rows.map((row) => row.table_name) };
  return db;
}

export type SeedArmedPullRequestOverrides = Partial<{
  armedPrId: string;
  userId: string;
  installationId: string;
  owner: string;
  repo: string;
  number: number;
}>;

export async function seedArmedPullRequest(db: Db, overrides: SeedArmedPullRequestOverrides = {}) {
  const seed = {
    armedPrId: "armed-1",
    userId: "user-1",
    installationId: "10",
    owner: "octo",
    repo: "repo",
    number: 7,
    ...overrides,
  };

  await db
    .insert(schema.user)
    .values({ id: seed.userId, name: "octocat", email: "o@example.com" })
    .onConflictDoNothing();
  await db
    .insert(schema.installation)
    .values({ id: seed.installationId, accountLogin: seed.owner, accountType: "Organization" })
    .onConflictDoNothing();
  await db.insert(schema.armedPr).values({
    id: seed.armedPrId,
    userId: seed.userId,
    installationId: seed.installationId,
    owner: seed.owner,
    repo: seed.repo,
    number: seed.number,
  });

  return seed;
}

export async function queueJob(db: Db, input: EnqueueJobInput): Promise<Job> {
  const queued = await enqueueJob(db, input);
  if (!queued) throw new Error(`no job was queued for ${input.armedPrId}`);
  return queued;
}
