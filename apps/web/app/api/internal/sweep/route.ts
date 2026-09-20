import { getDb } from "@/db";
import { env } from "@/env";
import { sweep } from "@/sweep";

const handle = (request: Request) =>
  sweep(request, { db: getDb(), secret: env.cronSecret(), log: console.error });

export const GET = handle;
export const POST = handle;
