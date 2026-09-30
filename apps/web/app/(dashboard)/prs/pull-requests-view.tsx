import Link from "next/link";
import { formatUpdated } from "@/format-updated";
import type { InstallationFailure, ListedPullRequest } from "@/pull-requests";
import type { PullRequestStatus } from "@/pull-request-status";
import type { RunnerStatus } from "@/runner-status";
import { PullRequestTable } from "./pull-request-table";

export function PullRequestsView({
  pullRequests,
  failures,
  installations,
  suspendedInstallations,
  syncFailed,
  statuses,
  runner,
  now,
}: {
  pullRequests: ListedPullRequest[];
  failures: InstallationFailure[];
  installations: number;
  suspendedInstallations: number;
  syncFailed: boolean;
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
            reviews on for <b>{statuses.size}</b>
          </span>
          {reviewing > 0 && (
            <span>
              <b>{reviewing}</b> in review
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
          {installations === 0 && syncFailed ? (
            <>
              <p>GitHub did not answer.</p>
              <p>
                Hawkeye could not check where it is installed, so your pull requests may be missing
                from this list. It checks again within a minute.
              </p>
            </>
          ) : installations === 0 && suspendedInstallations > 0 ? (
            <>
              <p>Hawkeye is suspended on every account where it is installed.</p>
              <p>
                Reviews are stopped until the App is resumed on GitHub.{" "}
                <Link href="/settings#installed">Where Hawkeye is installed</Link> lists the
                accounts.
              </p>
            </>
          ) : installations === 0 ? (
            <>
              <p>Hawkeye is not installed on a repository you can reach yet.</p>
              <p>
                <Link href="/settings#installed">Install the GitHub App</Link> from Settings; the
                pull requests you open there appear here within a minute.
              </p>
            </>
          ) : (
            <>
              <p>No open pull requests of yours in the repositories Hawkeye is installed on.</p>
              <p>
                <Link href="/settings#installed">Where Hawkeye is installed</Link> lists them; a
                pull request you open there appears here within a minute.
              </p>
            </>
          )}
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
