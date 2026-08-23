import type { GitHubClient } from "@hawkeye/core";
import type { Db } from "./db/client";
import type { armedPr, userSettings } from "./db/schema";
import { enqueueJob, type Job } from "./jobs";

const defaultQuietWindowSeconds = 180;

export type EnqueueTarget = {
  id: string;
  installationId: string;
  owner: string;
  repo: string;
  number: number;
};

export type EnqueueReviewInput = {
  armedPr: EnqueueTarget;
  headSha: string;
  baseSha: string;
  delaySeconds: number;
};

export function quietWindowSeconds(
  settings: Pick<typeof userSettings.$inferSelect, "quietWindowSeconds"> | undefined,
  pullRequest: Pick<typeof armedPr.$inferSelect, "quietWindowSeconds">,
): number {
  return (
    pullRequest.quietWindowSeconds ?? settings?.quietWindowSeconds ?? defaultQuietWindowSeconds
  );
}

export async function enqueueReviewForArmedPullRequest(
  deps: { db: Db; github: GitHubClient },
  input: EnqueueReviewInput,
): Promise<Job> {
  const reference = {
    owner: input.armedPr.owner,
    repo: input.armedPr.repo,
    number: input.armedPr.number,
  };
  const token = await deps.github.installationTokenById(input.armedPr.installationId);
  const mergeBase = await deps.github.mergeBase(reference, input.baseSha, input.headSha, token);

  return enqueueJob(deps.db, {
    armedPrId: input.armedPr.id,
    headSha: input.headSha,
    baseSha: mergeBase,
    notBefore: new Date(Date.now() + input.delaySeconds * 1000),
  });
}
