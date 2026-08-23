import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../db/client";
import * as schema from "../db/schema";

const migrationsFolder = join(import.meta.dirname, "..", "..", "drizzle");

export async function createTestDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
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
