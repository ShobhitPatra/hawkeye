import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { claimJob } from "@/runner-api";

export async function GET(request: Request) {
  return claimJob(request, { db: getDb(), github: createGitHubAppClient({ fetch }) });
}
