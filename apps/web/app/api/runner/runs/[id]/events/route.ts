import { getDb } from "@/db";
import { recordEvents } from "@/runner-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return recordEvents(request, { db: getDb() }, id);
}
