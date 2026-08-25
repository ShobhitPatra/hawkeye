"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { approveRunnerLogin } from "@/runner-login";
import { requireSession } from "@/session";

export type ApproveRunnerLoginState = { runnerName?: string; error?: string };

export async function approveRunnerLoginAction(
  _previous: ApproveRunnerLoginState,
  formData: FormData,
): Promise<ApproveRunnerLoginState> {
  const session = await requireSession();
  const code = String(formData.get("code") ?? "");
  try {
    const { runnerName } = await approveRunnerLogin(getDb(), { userId: session.user.id, code });
    revalidatePath("/connect");
    revalidatePath("/runners");
    return { runnerName };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "could not approve the login" };
  }
}
