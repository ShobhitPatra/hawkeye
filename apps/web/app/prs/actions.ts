"use server";

import { revalidatePath } from "next/cache";
import { parseArmInput, parsePullRequestInput } from "@/arm-input";
import { armPullRequest, disarmPullRequest } from "@/arming";
import { getDb } from "@/db";
import { installationBelongsToUser } from "@/installations";
import { requireSession } from "@/session";

export async function armAction(formData: FormData) {
  const session = await requireSession();
  const input = parseArmInput(formData);
  const db = getDb();

  if (!(await installationBelongsToUser(db, input.installationId, session.user.id))) {
    throw new Error(`installation ${input.installationId} is not linked to the signed-in user`);
  }

  await armPullRequest(db, { ...input, userId: session.user.id });
  revalidatePath("/prs");
}

export async function disarmAction(formData: FormData) {
  const session = await requireSession();
  const input = parsePullRequestInput(formData);

  await disarmPullRequest(getDb(), { ...input, userId: session.user.id });
  revalidatePath("/prs");
}
