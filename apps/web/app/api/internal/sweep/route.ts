import { getDb } from "@/db";
import { env } from "@/env";
import { createGitHubAppClient } from "@/github/app";
import { sweep } from "@/sweep";

const handle = (request: Request) =>
  sweep(request, {
    db: getDb(),
    github: createGitHubAppClient({ fetch }),
    secret: env.cronSecret(),
    log: console.error,
  });

export const GET = handle;
export const POST = handle;
