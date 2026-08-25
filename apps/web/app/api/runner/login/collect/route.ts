import { getDb } from "@/db";
import { collectLogin } from "@/runner-login-api";

export async function POST(request: Request) {
  return collectLogin(request, { db: getDb() });
}
