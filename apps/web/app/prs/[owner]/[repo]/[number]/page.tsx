import { notFound } from "next/navigation";
import { parsePullRequestParams } from "@/arm-input";
import { formatUpdated } from "@/format-updated";
import { getDb } from "@/db";
import { hasArmedPullRequest, listFindingsForPullRequest, listRunsForPullRequest } from "@/runs";
import {
  formatDuration,
  formatError,
  formatFindingLocation,
  formatVerdict,
  shortSha,
} from "@/run-format";
import { requireSession } from "@/session";

export default async function PullRequestRunsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; number: string }>;
}) {
  const session = await requireSession();
  let reference: ReturnType<typeof parsePullRequestParams>;
  try {
    reference = parsePullRequestParams(await params);
  } catch {
    notFound();
  }
  const db = getDb();
  const coordinates = { ...reference, userId: session.user.id };

  if (!(await hasArmedPullRequest(db, coordinates))) notFound();

  const [runs, findings] = await Promise.all([
    listRunsForPullRequest(db, coordinates),
    listFindingsForPullRequest(db, coordinates),
  ]);
  const now = Date.now();

  return (
    <main>
      <h1>
        {reference.owner}/{reference.repo}#{reference.number}
      </h1>
      <h2>Runs</h2>
      {runs.length === 0 ? (
        <p>No runs yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Started</th>
              <th>Head</th>
              <th>Status</th>
              <th>Verdict</th>
              <th>Turns</th>
              <th>Duration</th>
              <th>Error</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatUpdated(run.startedAt.toISOString(), now)}</td>
                <td>{shortSha(run.headSha)}</td>
                <td>{run.status}</td>
                <td>{formatVerdict(run)}</td>
                <td>{run.turns}</td>
                <td>{formatDuration(run)}</td>
                <td>{formatError(run.error)}</td>
                <td>
                  {run.reviewUrl && (
                    <a className="hk-link" href={run.reviewUrl}>
                      review
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Findings</h2>
      {findings.length === 0 ? (
        <p>No findings yet</p>
      ) : (
        <ul>
          {findings.map((finding) => (
            <li key={finding.stableId}>
              [{finding.stableId}] {finding.severity.replaceAll("_", " ")} {finding.claim}
              {formatFindingLocation(finding)} · first seen {shortSha(finding.firstSeenSha)} ·{" "}
              {finding.resolvedSha ? `resolved ${shortSha(finding.resolvedSha)}` : "open"}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
