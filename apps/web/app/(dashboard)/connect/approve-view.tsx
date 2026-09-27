import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import Link from "next/link";
import type { ReactNode } from "react";

export type LoginCodeState =
  | { state: "pending"; runnerName: string; requested: string }
  | { state: "approved"; runnerName: string }
  | { state: "expired" };

export function ApproveView({ code, form }: { code: LoginCodeState; form: ReactNode }) {
  return (
    <main className="hk-page">
      <nav className="hk-crumb" aria-label="Breadcrumb">
        <Link href="/runners">Runners</Link>
        <span className="hk-crumb-sep">/</span>
        <span>Connect</span>
      </nav>
      <div className="hk-header">
        <h1 className="hk-title">Approve a runner</h1>
      </div>
      {code.state === "pending" ? (
        <div className="hk-section">
          <p>
            A runner named <span className="hk-mono">{code.runnerName}</span> asked to connect{" "}
            {code.requested}. Type the code its terminal shows to approve it.
          </p>
          {form}
          <p className="hk-compact hk-muted hk-prose">
            Approving lets that machine claim your reviews and clone the repositories they need, as
            you. Approve only a runner you started.{" "}
            <a href={`${HAWKEYE_REPOSITORY_URL}/blob/main/README.md#what-the-runner-can-reach`}>
              What the runner can reach
            </a>
            .
          </p>
        </div>
      ) : code.state === "approved" ? (
        <div className="hk-state">
          <p>
            This code was already approved for <span className="hk-mono">{code.runnerName}</span>.
          </p>
          <p>
            <Link href="/runners">Runners</Link> shows whether it is online.
          </p>
        </div>
      ) : (
        <div className="hk-state">
          <p>This code is not pending.</p>
          <p>
            Codes last ten minutes. Start the runner again for a new one, or{" "}
            <Link href="/connect">connect a runner</Link> from the start.
          </p>
        </div>
      )}
    </main>
  );
}
