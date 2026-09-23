import { type Lens, type PullRequestReference, SEVERITIES, type Severity } from "@hawkeye/core";
import Link from "next/link";
import { formatUpdated } from "@/format-updated";
import { postingNote } from "@/posting-note";
import { formatDuration, formatError, runFailureLabel, shortSha, verdictLabel } from "@/run-format";
import type { ArmedPullRequestSummary, PullRequestFinding, PullRequestRun } from "@/runs";
import { ReviewControl } from "../../../review-control";
import { ReviewFromScratch } from "../../../review-from-scratch";

const SEVERITY_LABELS: Record<Severity, string> = {
  must_fix: "Must fix",
  should_fix: "Should fix",
  optional: "Optional",
  inherited: "Inherited",
};

const LENS_LABELS: Record<Lens, string> = {
  intent: "Intent",
  behavior: "Behavior",
  blast_radius: "Blast radius",
  verification: "Verification",
  fit: "Fit",
  hygiene: "Hygiene",
};

export function PullRequestView({
  reference,
  title,
  arm,
  runs,
  findings,
  now,
}: {
  reference: PullRequestReference;
  title?: string;
  arm: ArmedPullRequestSummary;
  runs: PullRequestRun[];
  findings: PullRequestFinding[];
  now: number;
}) {
  const htmlUrl = `https://github.com/${reference.owner}/${reference.repo}/pull/${reference.number}`;
  const latest = runs[0];
  const note = postingNote(latest?.error);
  const posted = runs.filter((run) => run.status === "ok" && run.reviewUrl).toReversed();
  const lastReview = posted.at(-1);
  const roundOf = (run: PullRequestRun) => posted.indexOf(run) + 1;
  const open = findings.filter((finding) => finding.resolvedSha === null);
  const resolved = findings.filter((finding) => finding.resolvedSha !== null);

  return (
    <main className="hk-page">
      <nav className="hk-crumb" aria-label="Breadcrumb">
        <Link href="/prs">Pull requests</Link>
        <span className="hk-crumb-sep">/</span>
        <span>
          {reference.owner}/{reference.repo}
        </span>
        <span className="hk-crumb-sep">/</span>
        <span className="hk-mono">#{reference.number}</span>
      </nav>

      <div className="hk-header">
        <div className="hk-title-row">
          <h1 className="hk-title">
            {title ?? `${reference.owner}/${reference.repo} #${reference.number}`}
          </h1>
          <div className="hk-actions">
            <ReviewControl
              reference={reference}
              installationId={arm.installationId}
              reviewing={arm.armed}
            />
            {lastReview && (
              <ReviewFromScratch reference={reference} installationId={arm.installationId} />
            )}
            <a className="hk-button" href={htmlUrl}>
              Open on GitHub
            </a>
          </div>
        </div>
        {latest && (
          <div className="hk-meta">
            <span>
              head <b className="hk-mono">{shortSha(latest.headSha)}</b>
            </span>
            {lastReview && (
              <span>
                round <b>{posted.length}</b>
              </span>
            )}
            {lastReview?.endedAt && (
              <span>
                reviewed <b>{formatUpdated(lastReview.endedAt.toISOString(), now)}</b>
              </span>
            )}
            {latest.runnerName && (
              <span>
                runner <b>{latest.runnerName}</b>
              </span>
            )}
            {lastReview && (
              <span>
                <b>{lastReview.turns}</b> turns
                {lastReview.endedAt && (
                  <>
                    {" "}
                    · <b className="hk-mono">{formatDuration(lastReview)}</b>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {!latest && (
        <div className="hk-state">
          <p>No review yet.</p>
          <p>
            {arm.armed
              ? "The next push queues one, or the runner picks up the job already waiting."
              : "Click Review and its next push is reviewed."}
          </p>
        </div>
      )}

      {latest?.status === "running" && (
        <div className="hk-state">
          <p>
            <span className="hk-status" data-state="running">
              In review
            </span>{" "}
            on {latest.runnerName ?? "your runner"}, started{" "}
            {formatUpdated(latest.startedAt.toISOString(), now)}.
          </p>
        </div>
      )}

      {latest && latest.status !== "running" && latest.status !== "ok" && (
        <div className="hk-state">
          <p>
            <span className="hk-status" data-state="failed">
              Run failed
            </span>{" "}
            {formatUpdated(latest.startedAt.toISOString(), now)}: {runFailureLabel(latest.status)}
            {latest.error ? `. ${formatError(latest.error)}` : "."}
          </p>
          <p>The pull request was not touched. The next push queues a new review.</p>
        </div>
      )}

      {latest?.status === "ok" && note && (
        <div className="hk-state">
          <p>
            <span className="hk-status" data-state="attention">
              {note.kind === "short-form" ? "Posted short" : "Not posted"}
            </span>{" "}
            {note.kind === "short-form"
              ? `GitHub refused the full review, so the short form is on the pull request: ${formatError(note.detail)}.`
              : `The review did not reach the pull request: ${formatError(note.detail)}.`}
          </p>
          <p>
            {note.kind === "short-form"
              ? "The full findings are below."
              : "The findings are below. The next push posts again."}
          </p>
        </div>
      )}

      {lastReview?.verdict && (
        <section className="hk-verdict" data-verdict={lastReview.verdict} aria-labelledby="verdict">
          <h2 className="hk-verdict-word" id="verdict">
            {verdictLabel(lastReview.verdict)}
          </h2>
          {lastReview.summary && <p className="hk-verdict-why">{lastReview.summary}</p>}
        </section>
      )}

      {open.length > 0 && (
        <section className="hk-margin" aria-label="Open findings">
          {SEVERITIES.flatMap((severity) =>
            open
              .filter((finding) => finding.severity === severity)
              .map((finding) => <FindingEntry key={finding.stableId} finding={finding} />),
          )}
        </section>
      )}

      {resolved.length > 0 && (
        <details className="hk-disclosure">
          <summary>
            {resolved.length} resolved finding{resolved.length === 1 ? "" : "s"}
          </summary>
          <div className="hk-margin">
            {resolved.map((finding) => (
              <FindingEntry key={finding.stableId} finding={finding} />
            ))}
          </div>
        </details>
      )}

      {runs.length > 0 && (
        <section aria-labelledby="rounds" className="hk-table-wrap">
          <table className="hk-table">
            <caption id="rounds">Runs</caption>
            <thead>
              <tr>
                <th scope="col" className="hk-numeric">
                  Round
                </th>
                <th scope="col">Head</th>
                <th scope="col">Result</th>
                <th scope="col" className="hk-numeric">
                  Turns
                </th>
                <th scope="col" className="hk-numeric">
                  Time
                </th>
                <th scope="col">Started</th>
                <th scope="col">
                  <span className="hk-visually-hidden">Review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  data-dim={run === lastReview || run === latest ? undefined : "true"}
                >
                  <td className="hk-numeric">{roundOf(run) || ""}</td>
                  <td className="hk-mono">{shortSha(run.headSha)}</td>
                  <td>
                    <RunResult run={run} />
                    {run.refusedModel && (
                      <span className="hk-muted">
                        {" "}
                        · on the default model, {run.refusedModel} was refused
                      </span>
                    )}
                  </td>
                  <td className="hk-numeric">{run.turns}</td>
                  <td className="hk-numeric hk-mono">{formatDuration(run)}</td>
                  <td>{formatUpdated(run.startedAt.toISOString(), now)}</td>
                  <td>{run.reviewUrl && <a href={run.reviewUrl}>Review</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {lastReview?.lenses && (
        <details className="hk-disclosure">
          <summary>Review lenses</summary>
          <div className="hk-table-wrap">
            <table className="hk-table">
              <thead>
                <tr>
                  <th scope="col">Lens</th>
                  <th scope="col">Assessment</th>
                </tr>
              </thead>
              <tbody>
                {lastReview.lenses.map((lens) => (
                  <tr key={lens.name}>
                    <td>{LENS_LABELS[lens.name]}</td>
                    <td>{lens.assessment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </main>
  );
}

function RunResult({ run }: { run: PullRequestRun }) {
  if (run.status === "running")
    return (
      <span className="hk-status" data-state="running">
        In review
      </span>
    );
  if (run.status !== "ok" || !run.verdict)
    return (
      <span className="hk-status" data-state="failed">
        Run failed
      </span>
    );
  return (
    <span className="hk-status" data-state={run.verdict === "blocked" ? "failed" : undefined}>
      {verdictLabel(run.verdict)}
      {run.reportedVerdict && run.reportedVerdict !== run.verdict && (
        <span className="hk-muted"> · reported {verdictLabel(run.reportedVerdict)}</span>
      )}
    </span>
  );
}

function FindingEntry({ finding }: { finding: PullRequestFinding }) {
  const isResolved = finding.resolvedSha !== null;
  return (
    <article className="hk-entry" data-severity={isResolved ? "inherited" : finding.severity}>
      <div className="hk-gutter">
        <span
          className="hk-label hk-severity"
          data-severity={isResolved ? "inherited" : finding.severity}
        >
          {SEVERITY_LABELS[finding.severity]}
        </span>
        {finding.line !== null && <span className="hk-mono">L{finding.line}</span>}
      </div>
      <div className="hk-entry-body">
        <h3 className="hk-claim">{finding.claim}</h3>
        {finding.path && (
          <p className="hk-path">
            <bdi>
              {finding.path}
              {finding.line !== null ? `:${finding.line}` : ""}
            </bdi>
          </p>
        )}
        {finding.detail && <p className="hk-detail">{finding.detail}</p>}
        <p className="hk-metadata">
          {isResolved && finding.resolvedSha ? (
            <>
              Resolved at <span className="hk-mono">{shortSha(finding.resolvedSha)}</span> ·{" "}
            </>
          ) : (
            <>
              Since <span className="hk-mono">{shortSha(finding.firstSeenSha)}</span> ·{" "}
            </>
          )}
          <span className="hk-mono">{finding.stableId}</span>
        </p>
      </div>
    </article>
  );
}
