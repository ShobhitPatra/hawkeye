import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { heartbeat } from "@/runner-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return heartbeat(request, { db: getDb(), github: createGitHubAppClient({ fetch }) }, id);
}
