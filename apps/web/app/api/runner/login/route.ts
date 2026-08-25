import { getDb } from "@/db";
import { startLogin } from "@/runner-login-api";
import { siteUrl } from "@/site-url";

export async function POST(request: Request) {
  return startLogin(request, { db: getDb(), siteUrl: siteUrl() });
}
