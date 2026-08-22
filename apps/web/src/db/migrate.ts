import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const db = createDb(process.env.DATABASE_URL);
await migrate(db, {
  migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
});
await db.$client.end();
