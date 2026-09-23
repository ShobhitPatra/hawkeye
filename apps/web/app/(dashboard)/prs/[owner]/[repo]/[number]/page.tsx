import { notFound } from "next/navigation";
import { parsePullRequestParams } from "@/arm-input";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
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
  const arm = await findArmedPullRequest(db, coordinates);
  if (!arm) notFound();

  const [runs, findings, [titled]] = await Promise.all([
    listRunsForPullRequest(db, coordinates),
    listFindingsForPullRequest(db, coordinates),
    fillTitles(db, createGitHubAppClient({ fetch }), [
      {
        ...reference,
        installationId: arm.installationId,
        armedPrId: arm.id,
        ...(arm.title === undefined ? {} : { title: arm.title }),
      },
    ]),
  ]);

  const title = titled?.title;
  return (
    <PullRequestView
      reference={reference}
      {...(title ? { title } : {})}
      arm={arm}
      runs={runs}
      findings={findings}
      now={Date.now()}
    />
  );
}
