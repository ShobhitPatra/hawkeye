import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { recordEvents } from "@/runner-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return recordEvents(request, { db: getDb(), github: createGitHubAppClient({ fetch }) }, id);
}
