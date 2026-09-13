import type { ReactNode } from "react";

export function SettingsView({ reviews }: { reviews: ReactNode }) {
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
    </main>
  );
}
