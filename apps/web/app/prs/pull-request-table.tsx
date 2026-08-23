import type { OpenPullRequest } from "@hawkeye/core";
import { formatUpdated } from "@/format-updated";

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
