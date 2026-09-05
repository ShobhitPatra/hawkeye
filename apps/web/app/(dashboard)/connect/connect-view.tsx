import Link from "next/link";
import type { ReactNode } from "react";
import type { RunnerStatus } from "@/runner-status";
import { CopyButton } from "../copy-button";

export type PendingLogin = {
  runnerName: string;
  state: "pending" | "approved" | "expired";
  requested: string;
};

export function ConnectView({
  controlPlaneUrl,
  pending,
  approve,
  runner,
  lastSeen,
}: {
  controlPlaneUrl: string;
  pending?: PendingLogin;
  approve: ReactNode;
  runner: RunnerStatus;
  lastSeen?: string;
}) {
  const login = `npx hawkeye-review runner login --url ${controlPlaneUrl}`;
  const start = "npx hawkeye-review runner";
  return (
    <main className="hk-page">
      <nav className="hk-crumb" aria-label="Breadcrumb">
        <Link href="/runners">Runners</Link>
        <span className="hk-crumb-sep">/</span>
        <span>Connect</span>
      </nav>
      <div className="hk-header">
        <h1 className="hk-title">Connect a runner</h1>
        <p className="hk-compact hk-muted hk-prose">
          Three steps on the machine that holds your Claude Code login. Nothing here leaves that
          machine except the review.
        </p>
      </div>

      <ol className="hk-steps">
        <li>
          <div className="hk-step-body">
            <p>Run this in a terminal on that machine.</p>
            <div className="hk-code-row">
              <pre className="hk-code">{login}</pre>
              <CopyButton text={login} />
            </div>
          </div>
        </li>
        <li>
          <div className="hk-step-body">
            <p>It prints a code. Type it here and approve it.</p>
            {approve}
            {pending?.state === "pending" && (
              <p className="hk-compact hk-muted">
                Requested {pending.requested} by a runner named{" "}
                <span className="hk-mono">{pending.runnerName}</span>. Approve it only if that is
                your machine.
              </p>
            )}
            {pending?.state === "expired" && (
              <p className="hk-compact">
                This code has expired. Codes last ten minutes. Run the login command again for a new
                one.
              </p>
            )}
            {pending?.state === "approved" && (
              <p className="hk-compact hk-muted">
                This code was already approved for{" "}
                <span className="hk-mono">{pending.runnerName}</span>.
              </p>
            )}
          </div>
        </li>
        <li>
          <div className="hk-step-body">
            <p>
              Start the runner. Leave it running; it polls for jobs and reviews armed pull requests
              as they change.
            </p>
            <div className="hk-code-row">
              <pre className="hk-code">{start}</pre>
              <CopyButton text={start} />
            </div>
          </div>
        </li>
      </ol>

      <hr className="hk-rule" />
      <div className="hk-state">
        <p>
          {runner.online ? (
            "A runner is online."
          ) : (
            <>
              No runner is{" "}
              <span className="hk-status" data-state="attention">
                online
              </span>
              {runner.waitingJobs > 0
                ? `; ${runner.waitingJobs} pull request${runner.waitingJobs === 1 ? " is" : "s are"} waiting.`
                : "."}
            </>
          )}
        </p>
        <p>
          {lastSeen && <>Last heartbeat {lastSeen}. </>}
          <Link href="/runners">All runners</Link>
        </p>
      </div>
    </main>
  );
}
