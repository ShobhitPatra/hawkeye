import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.js";

const db = createDb(process.env.DATABASE_URL);
await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
await db.$client.end();
