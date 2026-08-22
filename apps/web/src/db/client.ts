import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string | undefined) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return drizzle(new Pool({ connectionString }), { schema });
}
export type Db = ReturnType<typeof createDb>;
