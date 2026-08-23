import type { OpenPullRequest } from "@hawkeye/core";

const UNITS = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatUpdated(updatedAt: string, now: number) {
  const elapsed = new Date(updatedAt).getTime() - now;
  for (const { unit, ms } of UNITS) {
    if (Math.abs(elapsed) >= ms) return relativeTime.format(Math.round(elapsed / ms), unit);
  }
  return relativeTime.format(Math.round(elapsed / 1000), "second");
}

export function PullRequestTable({ pullRequests }: { pullRequests: OpenPullRequest[] }) {
  const now = Date.now();
  return (
    <table>
      <thead>
        <tr>
          <th>Repository</th>
          <th>Number</th>
          <th>Title</th>
          <th>Branch</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {pullRequests.map((pullRequest) => (
          <tr key={pullRequest.htmlUrl}>
            <td>
              {pullRequest.owner}/{pullRequest.repo}
            </td>
            <td>#{pullRequest.number}</td>
            <td>
              <a href={pullRequest.htmlUrl}>{pullRequest.title}</a>
            </td>
            <td>{pullRequest.headRef}</td>
            <td>{formatUpdated(pullRequest.updatedAt, now)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
