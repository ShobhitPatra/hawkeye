import { getDb } from "@/db";
import { env } from "@/env";
import { handleWebhook } from "@/github/webhook-handler";

export async function POST(request: Request) {
  return handleWebhook(request, { secret: env.githubWebhookSecret(), db: getDb() });
}
