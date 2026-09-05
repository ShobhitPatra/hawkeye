import Link from "next/link";
import { armedPullRequestKey } from "@/arming";
import { formatUpdated } from "@/format-updated";
import type { ListedPullRequest } from "@/pull-requests";
import type { PullRequestStatus } from "@/pull-request-status";
import { verdictLabel } from "@/run-format";
import { armAction, disarmAction } from "./actions";

function StatusWord({
  status,
  runnerOnline,
}: {
  status: PullRequestStatus;
  runnerOnline: boolean;
}) {
  switch (status.kind) {
    case "armed":
      return <span className="hk-status">Armed</span>;
    case "queued":
      return runnerOnline ? (
        <span className="hk-status">Queued</span>
      ) : (
        <span className="hk-status" data-state="attention">
          Waiting, runner offline
        </span>
      );
    case "reviewing":
      return (
        <span className="hk-status" data-state="running">
          Reviewing
        </span>
      );
    case "failed":
      return (
        <span className="hk-status" data-state="failed">
          Run failed
        </span>
      );
    case "reviewed": {
      const verdict = status.last?.verdict;
      if (!verdict) return <span className="hk-status">Reviewed</span>;
      return (
        <span className="hk-status" data-state={verdict === "blocked" ? "failed" : undefined}>
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
            <th scope="col">
              <span className="hk-visually-hidden">Armed</span>
            </th>
            <th scope="col">Pull request</th>
            <th scope="col">Status</th>
            <th scope="col" className="hk-numeric">
              Round
            </th>
            <th scope="col" className="hk-numeric">
              Findings
            </th>
            <th scope="col">Reviewed</th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.map((pullRequest) => {
            const status = statuses.get(armedPullRequestKey(pullRequest));
            const isArmed = status !== undefined;
            const pageHref = `/prs/${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`;
            const last = status?.last;
            return (
              <tr key={pullRequest.htmlUrl} data-dim={isArmed ? undefined : "true"}>
                <td className="hk-cell-arm">
                  <form action={isArmed ? disarmAction : armAction}>
                    <input type="hidden" name="owner" value={pullRequest.owner} />
                    <input type="hidden" name="repo" value={pullRequest.repo} />
                    <input type="hidden" name="number" value={pullRequest.number} />
                    <input type="hidden" name="installationId" value={pullRequest.installationId} />
                    <button
                      type="submit"
                      className="hk-arm"
                      data-armed={isArmed ? "true" : "false"}
                      aria-pressed={isArmed}
                      aria-label={isArmed ? "Disarm" : "Arm"}
                      title={isArmed ? "Disarm" : "Arm"}
                    />
                  </form>
                </td>
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
                    </span>
                  </div>
                </td>
                <td>
                  {status ? (
                    <StatusWord status={status} runnerOnline={runnerOnline} />
                  ) : (
                    <span className="hk-status">Not armed</span>
                  )}
                </td>
                <td className="hk-numeric">{last?.rounds ?? ""}</td>
                <td className="hk-numeric">{last?.openFindings ?? ""}</td>
                <td>{last ? formatUpdated(last.reviewedAt.toISOString(), now) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
