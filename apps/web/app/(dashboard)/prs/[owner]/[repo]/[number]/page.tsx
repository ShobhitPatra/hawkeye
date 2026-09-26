import { notFound } from "next/navigation";
import { parsePullRequestParams } from "@/arm-input";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { installationForOwner } from "@/installations";
import { findArmedPullRequest, listFindingsForPullRequest, listRunsForPullRequest } from "@/runs";
import { fillTitles, pullRequestTitles, titleKey } from "@/pull-request-titles";
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
  const arm = await findArmedPullRequest(db, coordinates);
  const installationId =
    arm?.installationId ?? (await installationForOwner(db, session.user.id, reference.owner));
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
      : pullRequestTitles(github, [{ ...reference, installationId }]).then((titles) =>
          titles.get(titleKey(reference)),
        ),
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
