import Link from "next/link";
import type { ReactNode } from "react";
import { RunnerRow, type RunnerRowData } from "./runner-row";

export function RunnersView({ runners, create }: { runners: RunnerRowData[]; create: ReactNode }) {
  return (
    <main className="hk-page">
      <div className="hk-header">
        <div className="hk-title-row">
          <h1 className="hk-title">Runners</h1>
          <div className="hk-actions">
            <Link className="hk-button" href="/connect">
              Connect from the command line
            </Link>
          </div>
        </div>
        <p className="hk-compact hk-muted hk-prose">
          A runner is one process on a machine you own. It polls for review jobs with its own token
          and runs Claude Code under your login. The control plane never sees that login.
        </p>
      </div>

      {runners.length === 0 ? (
        <div className="hk-state">
          <p>No runners yet.</p>
          <p>
            Connect one from the command line, or create a token below and pass it with{" "}
            <span className="hk-mono">--token</span>.
          </p>
        </div>
      ) : (
        <div className="hk-table-wrap">
          <table className="hk-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">State</th>
                <th scope="col">Last heartbeat</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="hk-visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runners.map((runner) => (
                <RunnerRow key={`${runner.id}:${runner.state === "revoked"}`} runner={runner} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="hk-rule" />

      <section className="hk-section" aria-labelledby="create">
        <h2 className="hk-heading" id="create">
          Create a runner token
        </h2>
        <p className="hk-compact hk-muted hk-prose">
          For machines without a browser. The token is shown once.
        </p>
        {create}
      </section>
    </main>
  );
}
