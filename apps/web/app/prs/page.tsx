import Link from "next/link";
import { listArmedPullRequests } from "@/arming";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { listUserOpenPullRequests } from "@/pull-requests";
import { describeRunnerStatus, runnerStatus } from "@/runner-status";
import { requireSession } from "@/session";
import { PullRequestTable } from "./pull-request-table";

export default async function PullRequestsPage() {
  const session = await requireSession();
  const login = session.user.githubLogin;

  if (!login) {
    return (
      <main>
        <h1>Pull requests</h1>
        <p>Sign out and in again to load your pull requests.</p>
      </main>
    );
  }

  const db = getDb();
  const [{ pullRequests, failures }, armed, runner] = await Promise.all([
    listUserOpenPullRequests(
      { db, github: createGitHubAppClient({ fetch }) },
      { userId: session.user.id, login },
    ),
    listArmedPullRequests(db, session.user.id),
    runnerStatus(db, session.user.id),
  ]);

  return (
    <main>
      <h1>Pull requests</h1>
      <p>
        {describeRunnerStatus(runner)}
        {!runner.online && (
          <>
            {" "}
            <Link href="/connect">Connect a runner</Link>
          </>
        )}
      </p>
      {pullRequests.length === 0 ? (
        <p>No open pull requests</p>
      ) : (
        <PullRequestTable pullRequests={pullRequests} armed={armed} />
      )}
      {failures.length > 0 && (
        <ul>
          {failures.map((failure) => (
            <li key={failure.installationId}>
              Could not load installation {failure.installationId}: {failure.message}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
