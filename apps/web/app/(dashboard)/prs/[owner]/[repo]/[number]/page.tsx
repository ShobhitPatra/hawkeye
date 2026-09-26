import { notFound } from "next/navigation";
import { parsePullRequestParams } from "@/arm-input";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { assertAuthoredBy, assertPullRequestInInstallation } from "@/arm-guard";
import { installationForOwner } from "@/installations";
import { findArmedPullRequest, listFindingsForPullRequest, listRunsForPullRequest } from "@/runs";
import { fillTitles } from "@/pull-request-titles";
import { requireSession } from "@/session";
import { PullRequestView } from "./pull-request-view";

export default async function PullRequestPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const session = await requireSession();
  let reference: ReturnType<typeof parsePullRequestParams>;
  try {
    reference = parsePullRequestParams(await params);
  } catch {
    notFound();
  }
  const db = getDb();
  const coordinates = { ...reference, userId: session.user.id };
  const [arm, liveInstallationId] = await Promise.all([
    findArmedPullRequest(db, coordinates),
    installationForOwner(db, session.user.id, reference.owner),
  ]);
  const installationId = liveInstallationId ?? arm?.installationId;
  if (installationId === undefined) notFound();
  const github = createGitHubAppClient({ fetch });

  const [runs, findings, title] = await Promise.all([
    listRunsForPullRequest(db, coordinates),
    listFindingsForPullRequest(db, coordinates),
    arm
      ? fillTitles(db, github, [
          {
            ...reference,
            installationId,
            armedPrId: arm.id,
            ...(arm.title === undefined ? {} : { title: arm.title }),
          },
        ]).then(([titled]) => titled?.title)
      : ownPullRequestTitle(github, installationId, reference, session.user.githubLogin),
  ]);

  return (
    <PullRequestView
      reference={reference}
      {...(title ? { title } : {})}
      installationId={installationId}
      armed={arm?.armed ?? false}
      runs={runs}
      findings={findings}
      now={Date.now()}
    />
  );
}

async function ownPullRequestTitle(
  github: ReturnType<typeof createGitHubAppClient>,
  installationId: string,
  reference: ReturnType<typeof parsePullRequestParams>,
  login: string | null | undefined,
): Promise<string> {
  let title: string;
  try {
    const { pullRequest } = await assertPullRequestInInstallation(
      github,
      installationId,
      reference,
    );
    assertAuthoredBy(pullRequest, login);
    title = pullRequest.title;
  } catch {
    notFound();
  }
  return title;
}
