import { headers } from "next/headers";
import { getAuth } from "@/auth";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { syncInstallationsForUser } from "@/installation-sync";
import { listPullRequestStatuses } from "@/pull-request-status";
import { listUserOpenPullRequests } from "@/pull-requests";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { PullRequestsView } from "./pull-requests-view";

export default async function PullRequestsPage() {
  const session = await requireSession();
  const login = session.user.githubLogin;

  if (!login) {
    return (
      <main className="hk-page">
        <div className="hk-header">
          <h1 className="hk-title">Pull requests</h1>
        </div>
        <div className="hk-state">
          <p>Your GitHub login is not on this session.</p>
          <p>Sign out and in again to load your pull requests.</p>
        </div>
      </main>
    );
  }

  const db = getDb();
  const github = createGitHubAppClient({ fetch });
  const requestHeaders = await headers();
  const [{ pullRequests, failures }, statuses, runner] = await Promise.all([
    listUserOpenPullRequests(
      {
        db,
        github,
        syncInstallations: () =>
          syncInstallationsForUser(
            { auth: getAuth(), db, github },
            session.user.id,
            requestHeaders,
          ),
      },
      { userId: session.user.id, login },
    ),
    listPullRequestStatuses(db, session.user.id),
    requestRunnerStatus(session.user.id),
  ]);

  return (
    <PullRequestsView
      pullRequests={pullRequests}
      failures={failures}
      statuses={statuses}
      runner={runner}
      now={Date.now()}
    />
  );
}
