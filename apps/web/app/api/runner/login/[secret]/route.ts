import { getDb } from "@/db";
import { collectLogin } from "@/runner-login-api";
import { siteUrl } from "@/site-url";

export async function GET(_request: Request, context: { params: Promise<{ secret: string }> }) {
  const { secret } = await context.params;
  return collectLogin({ db: getDb(), siteUrl: siteUrl() }, secret);
}
