import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import Link from "next/link";
import type { ReactNode } from "react";
import type { RunnerStatus } from "@/runner-status";
import { CodeBlock } from "../../code-block";
import { RunnerSentence } from "../runner-sentence";

export function ConnectView({
  command,
  approve,
  runner,
  now,
}: {
  command: string;
  approve: ReactNode;
  runner: RunnerStatus;
  now: number;
}) {
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
          Two steps on the machine that holds your Claude Code or Codex login. Nothing here leaves
          that machine except the review.
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
            <p>
              Run this in a terminal on that machine, and leave it running. It reviews your pull
              requests as they change.
            </p>
            <CodeBlock text={command} />
          </div>
        </li>
        <li>
          <div className="hk-step-body">
            <p>
              Its first run opens this page and prints a code. Type the code here and approve it.
            </p>
            {approve}
          </div>
        </li>
      </ol>

      <hr className="hk-rule" />
      <RunnerSentence runner={runner} now={now} />
    </main>
  );
}
