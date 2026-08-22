import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}
export type Db = ReturnType<typeof createDb>;
