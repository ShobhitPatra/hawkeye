import Link from "next/link";
import { formatUpdated } from "@/format-updated";
import type { InstallationFailure, ListedPullRequest } from "@/pull-requests";
import type { PullRequestStatus } from "@/pull-request-status";
import type { RunnerStatus } from "@/runner-status";
import { PullRequestTable } from "./pull-request-table";

export function PullRequestsView({
  pullRequests,
  failures,
  statuses,
  runner,
  now,
}: {
  pullRequests: ListedPullRequest[];
  failures: InstallationFailure[];
  statuses: Map<string, PullRequestStatus>;
  runner: RunnerStatus;
  now: number;
}) {
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
          <p>No open pull requests of yours in the repos this app is installed on.</p>
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
          now={now}
        />
      )}

      {failures.map((failure) => (
        <div className="hk-state" key={failure.installationId}>
          <p>GitHub did not answer for installation {failure.installationId}.</p>
          <p>Its pull requests are missing from this list. {failure.message}</p>
        </div>
      ))}
    </main>
  );
}
