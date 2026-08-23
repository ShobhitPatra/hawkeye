import { getDb } from "@/db";
import { recordResult } from "@/runner-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return recordResult(request, { db: getDb() }, id);
}
