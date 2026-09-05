"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { createRunnerToken, normalizeRunnerName, revokeRunnerToken } from "@/runner-tokens";
import { requireSession } from "@/session";

export type CreateRunnerState = { token?: string; error?: string };

export async function createRunnerAction(
  _previous: CreateRunnerState,
  formData: FormData,
): Promise<CreateRunnerState> {
  const session = await requireSession();
  let name: string;
  try {
    name = normalizeRunnerName(String(formData.get("name") ?? ""));
  } catch (error) {
    return { error: (error as Error).message };
  }
  const { token } = await createRunnerToken(getDb(), { userId: session.user.id, name });
  revalidatePath("/runners");
  return { token };
}

export async function revokeRunnerAction(formData: FormData) {
  const session = await requireSession();
  const runnerId = String(formData.get("runnerId") ?? "");
  if (!runnerId) throw new Error("a runner id is required");

  await revokeRunnerToken(getDb(), { userId: session.user.id, runnerId });
  revalidatePath("/runners");
}
