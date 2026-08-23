import type { GitHubClient } from "@hawkeye/core";
import type { Db } from "./db/client";
import { enqueueJob, type Job } from "./jobs";

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
  token: string;
};

export async function enqueueReviewForArmedPullRequest(
  deps: { db: Db; github: GitHubClient },
  input: EnqueueReviewInput,
): Promise<Job> {
  const reference = {
    owner: input.armedPr.owner,
    repo: input.armedPr.repo,
    number: input.armedPr.number,
  };
  const mergeBase = await deps.github.mergeBase(
    reference,
    input.baseSha,
    input.headSha,
    input.token,
  );

  return enqueueJob(deps.db, {
    armedPrId: input.armedPr.id,
    headSha: input.headSha,
    baseSha: mergeBase,
    notBefore: new Date(Date.now() + input.delaySeconds * 1000),
  });
}
