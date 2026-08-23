import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  return drizzle(new Pool({ connectionString }), { schema });
}
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
