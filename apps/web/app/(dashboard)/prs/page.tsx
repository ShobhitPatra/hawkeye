import Link from "next/link";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { listPullRequestStatuses } from "@/pull-request-status";
import { listUserOpenPullRequests } from "@/pull-requests";
import { formatUpdated } from "@/format-updated";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { PullRequestTable } from "./pull-request-table";

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
  const [{ pullRequests, failures }, statuses, runner] = await Promise.all([
    listUserOpenPullRequests(
      { db, github: createGitHubAppClient({ fetch }) },
      { userId: session.user.id, login },
    ),
    listPullRequestStatuses(db, session.user.id),
    requestRunnerStatus(session.user.id),
  ]);
  const now = Date.now();
  const reviewing = [...statuses.values()].filter((status) => status.kind === "reviewing").length;

  return (
    <main className="hk-page">
      <div className="hk-header">
        <h1 className="hk-title">Pull requests</h1>
        <div className="hk-meta">
          <span>
            <b>{statuses.size}</b> armed
          </span>
          {reviewing > 0 && (
            <span>
              <b>{reviewing}</b> reviewing
            </span>
          )}
          <span>
            runner{" "}
            {runner.online ? (
              <b>online</b>
            ) : (
              <span className="hk-status" data-state="attention">
                offline
              </span>
            )}
            {!runner.online && runner.lastSeenAt && (
              <>, last heartbeat {formatUpdated(runner.lastSeenAt.toISOString(), now)}</>
            )}
          </span>
        </div>
      </div>

      {!runner.online && runner.waitingJobs > 0 && (
        <div className="hk-state">
          <p>
            Runner offline. {runner.waitingJobs} pull request
            {runner.waitingJobs === 1 ? " is" : "s are"} waiting and will be reviewed when it
            reconnects.
          </p>
          <p>
            <Link href="/connect">Start the runner</Link>
          </p>
        </div>
      )}

      {pullRequests.length === 0 ? (
        <div className="hk-state">
          <p>No open pull requests in the repos this app is installed on.</p>
          <p>
            <a href="https://github.com/settings/installations">
              Install the GitHub App on another repo
            </a>{" "}
            to see its pull requests here.
          </p>
        </div>
      ) : (
        <PullRequestTable
          pullRequests={pullRequests}
          statuses={statuses}
          runnerOnline={runner.online}
        />
      )}

      {failures.map((failure) => (
        <div className="hk-state" key={failure.installationId}>
          <p>GitHub did not answer for installation {failure.installationId}.</p>
          <p>Nothing was lost. {failure.message}</p>
        </div>
      ))}
    </main>
  );
}
