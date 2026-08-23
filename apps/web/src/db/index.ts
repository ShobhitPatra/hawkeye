import { env } from "../env";
import { createDb } from "./client";

const dbCache = globalThis as typeof globalThis & { hawkeyeDb?: ReturnType<typeof createDb> };

export function getDb() {
  dbCache.hawkeyeDb ??= createDb(env.databaseUrl());
  return dbCache.hawkeyeDb;
}
