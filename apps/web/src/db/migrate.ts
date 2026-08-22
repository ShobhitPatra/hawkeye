import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { env } from "../env";
import { createDb } from "./client";

const db = createDb(env.databaseUrl());
await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
});
await db.$client.end();
