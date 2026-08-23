import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { listUserOpenPullRequests } from "@/pull-requests";
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

  const { pullRequests, failures } = await listUserOpenPullRequests(
    { db: getDb(), github: createGitHubAppClient({ fetch }) },
    { userId: session.user.id, login },
  );

  return (
    <main>
      <h1>Pull requests</h1>
      {pullRequests.length === 0 ? (
        <p>No open pull requests</p>
      ) : (
        <PullRequestTable pullRequests={pullRequests} />
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
