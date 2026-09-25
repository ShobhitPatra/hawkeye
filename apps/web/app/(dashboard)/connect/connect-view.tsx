import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import Link from "next/link";
import type { ReactNode } from "react";
import type { RunnerStatus } from "@/runner-status";
import { CodeBlock } from "../../code-block";
import { RunnerSentence } from "../runner-sentence";

export function ConnectView({
  controlPlaneUrl,
  approve,
  runner,
  now,
}: {
  controlPlaneUrl: string;
  approve: ReactNode;
  runner: RunnerStatus;
  now: number;
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
        <p className="hk-compact hk-muted hk-prose">
          A review runs a coding agent on that machine, as you, over code you did not write. Its
          editing and web tools are removed; the shell stays, so connect a machine whose files you
          would let that code read.{" "}
          <a href={`${HAWKEYE_REPOSITORY_URL}/blob/main/README.md#what-the-runner-can-reach`}>
            What the runner can reach
          </a>
          .
        </p>
      </div>

      <ol className="hk-steps" role="list">
        <li>
          <div className="hk-step-body">
            <p>Run this in a terminal on that machine.</p>
            <CodeBlock text={login} />
          </div>
        </li>
        <li>
          <div className="hk-step-body">
            <p>It prints a code. Type it here and approve it.</p>
            {approve}
          </div>
        </li>
        <li>
          <div className="hk-step-body">
            <p>
              Start the runner. Leave it running; it polls for jobs and reviews your pull requests
              as they change.
            </p>
            <CodeBlock text={start} />
          </div>
        </li>
      </ol>

      <hr className="hk-rule" />
      <RunnerSentence runner={runner} now={now} />
    </main>
  );
}
