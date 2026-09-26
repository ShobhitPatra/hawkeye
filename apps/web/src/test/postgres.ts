import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { createDb, Db } from "../db/client";

const MIGRATION_LOCK = 7_210_001;

export function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

export function holdingCommit(db: Db, hold: { entered: () => void; released: Promise<void> }): Db {
  return Object.assign(Object.create(db) as Db, {
    transaction: ((work: (tx: Db) => Promise<unknown>) =>
      db.transaction(async (tx) => {
        const outcome = await work(tx);
        hold.entered();
        await hold.released;
        return outcome;
      })) as Db["transaction"],
  });
}

// Test files run in parallel against one database, and two migrations at once fail on a fresh one.
export async function migrateOnce(db: ReturnType<typeof createDb>): Promise<void> {
  const client = await db.$client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder: join(import.meta.dirname, "..", "..", "drizzle") });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    client.release();
  }
}
