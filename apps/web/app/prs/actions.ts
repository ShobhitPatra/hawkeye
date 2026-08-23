"use server";

import { revalidatePath } from "next/cache";
import { parseArmInput, parsePullRequestInput } from "@/arm-input";
import { assertPullRequestInInstallation } from "@/arm-guard";
import { armPullRequest, disarmPullRequest } from "@/arming";
import { enqueueReviewForArmedPullRequest } from "@/enqueue";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { installationBelongsToUser } from "@/installations";
import { requireSession } from "@/session";

export async function armAction(formData: FormData) {
  const session = await requireSession();
  const input = parseArmInput(formData);
  const db = getDb();

  if (!(await installationBelongsToUser(db, input.installationId, session.user.id))) {
    throw new Error(`installation ${input.installationId} is not linked to the signed-in user`);
  }

  const github = createGitHubAppClient({ fetch });
  const { token, pullRequest } = await assertPullRequestInInstallation(
    github,
    input.installationId,
    input,
  );

  const armed = await armPullRequest(db, { ...input, userId: session.user.id });
  await enqueueReviewForArmedPullRequest(
    { db, github },
    {
      armedPr: armed,
      headSha: pullRequest.headSha,
      baseSha: pullRequest.baseSha,
      delaySeconds: 0,
      token,
    },
  );
  revalidatePath("/prs");
}

export async function disarmAction(formData: FormData) {
  const session = await requireSession();
  const input = parsePullRequestInput(formData);

  await disarmPullRequest(getDb(), { ...input, userId: session.user.id });
  revalidatePath("/prs");
}
