import {
  FUNNEL_STEPS,
  type Funnel,
  type FunnelCounts,
  type FunnelStep,
  keptFromPrevious,
} from "@/funnel";

const STEP_LABELS: Record<FunnelStep, string> = {
  signedIn: "Signed in",
  installed: "Installed the App",
  connected: "Connected a runner",
  online: "Runner came online",
  reviewed: "Got a first review",
};

function kept(counts: FunnelCounts, step: FunnelStep): string {
  const share = keptFromPrevious(counts, step);
  return share === undefined ? "" : `${share}% of the step before`;
}

function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function FunnelView({ funnel }: { funnel: Funnel }) {
  return (
    <main className="hk-page">
      <div className="hk-header">
        <h1 className="hk-title">Funnel</h1>
        <p className="hk-compact hk-muted hk-prose">
          How far people get from signing in to a first review, counted from this instance's own
          database. Nothing on this page is sent anywhere.
        </p>
      </div>

      {funnel.total.signedIn === 0 ? (
        <div className="hk-state">
          <p>Nobody has signed in yet.</p>
          <p>The first sign-in starts the count.</p>
        </div>
      ) : (
        <>
          <section className="hk-figures" aria-label="All time">
            {FUNNEL_STEPS.map((step) => (
              <div className="hk-figure" key={step}>
                <span className="hk-figure-label">{STEP_LABELS[step]}</span>
                <span className="hk-figure-value">{funnel.total[step]}</span>
                <span className="hk-figure-note">{kept(funnel.total, step) || "all time"}</span>
              </div>
            ))}
          </section>

          <div className="hk-table-wrap">
            <table className="hk-table">
              <caption className="hk-visually-hidden">
                Each week's new sign-ins and how many of them reached each step
              </caption>
              <thead>
                <tr>
                  <th scope="col">Signed in the week of</th>
                  {FUNNEL_STEPS.map((step) => (
                    <th scope="col" className="hk-numeric" key={step}>
                      {STEP_LABELS[step]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnel.weeks.map((week) => (
                  <tr key={week.weekStart}>
                    <th scope="row">{weekLabel(week.weekStart)}</th>
                    {FUNNEL_STEPS.map((step) => (
                      <td className="hk-numeric" key={step}>
                        {week[step]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
