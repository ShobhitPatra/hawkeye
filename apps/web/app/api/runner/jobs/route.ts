import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { claimJob } from "@/runner-api";

export const maxDuration = 30;

export async function GET(request: Request) {
  return claimJob(request, {
    db: getDb(),
    github: createGitHubAppClient({ fetch }),
    log: console.error,
  });
}
