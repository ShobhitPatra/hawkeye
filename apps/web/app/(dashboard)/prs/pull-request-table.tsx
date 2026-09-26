import Link from "next/link";
import { armedPullRequestKey } from "@/arming";
import { formatUpdated } from "@/format-updated";
import type { ListedPullRequest } from "@/pull-requests";
import type { PullRequestStatus } from "@/pull-request-status";
import { verdictLabel } from "@/run-format";

function StatusWord({
  status,
  runnerOnline,
}: {
  status: PullRequestStatus;
  runnerOnline: boolean;
}) {
  switch (status.kind) {
    case "armed":
      return (
        <span key="on" className="hk-status hk-arrive">
          Reviews on
        </span>
      );
    case "queued":
      return runnerOnline ? (
        <span key="queued" className="hk-status hk-arrive">
          Queued
        </span>
      ) : (
        <span key="waiting" className="hk-status hk-arrive" data-state="attention">
          Waiting, runner offline
        </span>
      );
    case "reviewing":
      return (
        <span key="reviewing" className="hk-status hk-arrive" data-state="running">
          In review
        </span>
      );
    case "failed":
      return (
        <span key="failed" className="hk-status hk-arrive" data-state="failed">
          Run failed
        </span>
      );
    case "reviewed": {
      const { verdict } = status.last;
      return (
        <span
          key={verdict}
          className="hk-status hk-arrive"
          data-state={verdict === "blocked" ? "failed" : undefined}
        >
          {verdictLabel(verdict)}
        </span>
      );
    }
  }
}

export function PullRequestTable({
  pullRequests,
  statuses,
  runnerOnline,
  now,
}: {
  pullRequests: ListedPullRequest[];
  statuses: Map<string, PullRequestStatus>;
  runnerOnline: boolean;
  now: number;
}) {
  return (
    <div className="hk-table-wrap">
      <table className="hk-table">
        <thead>
          <tr>
            <th scope="col">Pull request</th>
            <th scope="col">Status</th>
            <th scope="col" className="hk-numeric" data-secondary>
              Round
            </th>
            <th scope="col" className="hk-numeric">
              Findings
            </th>
            <th scope="col" data-secondary>
              Reviewed
            </th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.map((pullRequest) => {
            const status = statuses.get(armedPullRequestKey(pullRequest));
            const isArmed = status !== undefined;
            const pageHref = `/prs/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`;
            const last = status && status.kind !== "armed" ? status.last : undefined;
            return (
              <tr key={pullRequest.htmlUrl} data-dim={isArmed ? undefined : "true"}>
                <td>
                  <div className="hk-cell-stack">
                    {isArmed ? (
                      <Link href={pageHref}>{pullRequest.title}</Link>
                    ) : (
                      <a href={pullRequest.htmlUrl}>{pullRequest.title}</a>
                    )}
                    <span className="hk-metadata">
                      {pullRequest.owner}/{pullRequest.repo}{" "}
                      <span className="hk-mono">#{pullRequest.number}</span>
                      {!isArmed && " · on GitHub"}
                    </span>
                  </div>
                </td>
                <td>
                  {status ? (
                    <StatusWord status={status} runnerOnline={runnerOnline} />
                  ) : (
                    <span key="off" className="hk-status hk-arrive">
                      Off
                    </span>
                  )}
                </td>
                <td className="hk-numeric" data-secondary>
                  {last?.rounds ?? ""}
                </td>
                <td className="hk-numeric">{last?.openFindings ?? ""}</td>
                <td data-secondary>
                  {last ? formatUpdated(last.reviewedAt.toISOString(), now) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
