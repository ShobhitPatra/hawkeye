import { armedPullRequestKey } from "@/arming";
import { formatUpdated } from "@/format-updated";
import type { ListedPullRequest } from "@/pull-requests";
import { armAction, disarmAction } from "./actions";

export function PullRequestTable({
  pullRequests,
  armed,
}: {
  pullRequests: ListedPullRequest[];
  armed: Set<string>;
}) {
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
          <th>Review</th>
        </tr>
      </thead>
      <tbody>
        {pullRequests.map((pullRequest) => {
          const isArmed = armed.has(armedPullRequestKey(pullRequest));
          return (
            <tr key={pullRequest.htmlUrl}>
              <td>
                {pullRequest.owner}/{pullRequest.repo}
              </td>
              <td>#{pullRequest.number}</td>
              <td>
                <a href={pullRequest.htmlUrl}>{pullRequest.title}</a>
                {isArmed && <span> armed</span>}
              </td>
              <td>{pullRequest.headRef}</td>
              <td>{formatUpdated(pullRequest.updatedAt, now)}</td>
              <td>
                <form action={isArmed ? disarmAction : armAction}>
                  <input type="hidden" name="owner" value={pullRequest.owner} />
                  <input type="hidden" name="repo" value={pullRequest.repo} />
                  <input type="hidden" name="number" value={pullRequest.number} />
                  <input type="hidden" name="installationId" value={pullRequest.installationId} />
                  <button type="submit">{isArmed ? "Disarm" : "Arm"}</button>
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
