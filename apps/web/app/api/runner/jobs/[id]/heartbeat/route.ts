import { getDb } from "@/db";
import { heartbeat } from "@/runner-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return heartbeat(request, { db: getDb() }, id);
}
