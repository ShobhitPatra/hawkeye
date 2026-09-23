import type { ReactNode } from "react";

export function SettingsView({ reviews, runner }: { reviews: ReactNode; runner: ReactNode }) {
  return (
    <main className="hk-page">
      <div className="hk-header">
        <h1 className="hk-title">Settings</h1>
      </div>
      <section className="hk-section" aria-labelledby="reviews-heading">
        <h2 className="hk-heading" id="reviews-heading">
          Reviews
        </h2>
        <p className="hk-compact hk-muted hk-prose">
          How reviews start for the pull requests you author. Each pull request can still be paused
          or turned on from the pull requests page.
        </p>
        {reviews}
      </section>
      <hr className="hk-rule" />
      <section className="hk-section" aria-labelledby="runner-heading">
        <h2 className="hk-heading" id="runner-heading">
          Runner
        </h2>
        <p className="hk-compact hk-muted hk-prose">
          What each review runs with on your machine. Reviews run with Claude Code or Codex under
          your own login; the control plane never sees it.
        </p>
        {runner}
      </section>
    </main>
  );
}
