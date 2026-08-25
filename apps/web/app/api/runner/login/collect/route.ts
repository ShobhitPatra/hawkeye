import { getDb } from "@/db";
import { collectLogin } from "@/runner-login-api";
import { siteUrl } from "@/site-url";

export async function POST(request: Request) {
  return collectLogin(request, { db: getDb(), siteUrl: siteUrl() });
}
