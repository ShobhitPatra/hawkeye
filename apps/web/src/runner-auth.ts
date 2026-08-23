import type { Db } from "./db/client";
import { authenticateRunner, type Runner } from "./runner-tokens";

export async function requireRunner(request: Request, db: Db): Promise<Runner | Response> {
  const runner = await authenticateRunner(db, request.headers.get("authorization"));
  if (!runner) return Response.json({ error: "unauthorized" }, { status: 401 });
  return runner;
}
