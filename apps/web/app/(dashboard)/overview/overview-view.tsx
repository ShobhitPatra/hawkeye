import Link from "next/link";
import { formatUpdated } from "@/format-updated";
import { dayKey, type Overview, type Totals, yearDays } from "@/overview";
import { verdictLabel } from "@/run-format";
import type { RunnerStatus } from "@/runner-status";
import { RunnerSentence } from "../runner-sentence";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function hoursAndMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

function level(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 2) return 2;
  if (count <= 3) return 3;
  return 4;
}

export function OverviewView({
  overview,
  runner,
  now,
}: {
  overview: Overview;
  runner: RunnerStatus;
  now: Date;
}) {
  const empty = overview.allTime.reviews === 0 && overview.allTime.findings === 0;
  const days = yearDays(now);
  const monthLabels = days.flatMap((day, index) =>
    day.getUTCDate() <= 7 && index % 7 === 0 && index > 7
      ? [{ column: index / 7 + 1, label: MONTHS[day.getUTCMonth()]! }]
      : [],
  );

  return (
    <main className="hk-page hk-overview">
      <div className="hk-header">
        <h1 className="hk-title">Overview</h1>
        {empty ? <EmptySentence /> : <RunnerSentence runner={runner} now={now.getTime()} />}
      </div>

      <Figures allTime={overview.allTime} thisMonth={overview.thisMonth} />

      <section className="hk-section" aria-labelledby="year">
        <h2 className="hk-heading" id="year">
          The last year
        </h2>
        <div className="hk-heat">
          <div className="hk-heat-months" aria-hidden="true">
            {monthLabels.map((month) => (
              <span key={`${month.column}-${month.label}`} style={{ gridColumn: month.column }}>
                {month.label}
              </span>
            ))}
          </div>
          <div
            className="hk-heat-grid"
            role="img"
            aria-label="Reviews per day over the last 52 weeks"
          >
            {days.map((day) => {
              const count = day <= now ? (overview.reviewsByDay.get(dayKey(day)) ?? 0) : 0;
              const date = `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
              const title =
                count === 0
                  ? `No reviews on ${date}`
                  : `${count} review${count === 1 ? "" : "s"} on ${date}`;
              return (
                <i
                  key={dayKey(day)}
                  data-level={level(count)}
                  title={day <= now ? title : undefined}
                />
              );
            })}
          </div>
          <div className="hk-heat-key" aria-hidden="true">
            <span>Fewer</span>
            <i data-level={0} />
            <i data-level={1} />
            <i data-level={2} />
            <i data-level={3} />
            <i data-level={4} />
            <span>More</span>
          </div>
        </div>
      </section>

      {overview.recent.length > 0 && (
        <section className="hk-section" aria-labelledby="recent">
          <h2 className="hk-heading" id="recent">
            Recent reviews
          </h2>
          <div className="hk-table-wrap">
            <table className="hk-table">
              <thead>
                <tr>
                  <th scope="col">Pull request</th>
                  <th scope="col">Verdict</th>
                  <th scope="col" className="hk-numeric">
                    Turns
                  </th>
                  <th scope="col">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {overview.recent.map((review) => (
                  <tr
                    key={`${review.owner}/${review.repo}#${review.number}-${review.endedAt.getTime()}`}
                  >
                    <td>
                      <div className="hk-cell-stack">
                        <Link href={`/prs/${review.owner}/${review.repo}/${review.number}`}>
                          {review.title ?? `${review.owner}/${review.repo} #${review.number}`}
                        </Link>
                        <span className="hk-metadata">
                          {review.owner}/{review.repo}{" "}
                          <span className="hk-mono">#{review.number}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className="hk-status"
                        data-state={review.verdict === "blocked" ? "failed" : undefined}
                      >
                        {verdictLabel(review.verdict)}
                      </span>
                    </td>
                    <td className="hk-numeric">{review.turns}</td>
                    <td>{formatUpdated(review.endedAt.toISOString(), now.getTime())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hk-state hk-compact hk-muted">
            <Link href="/prs">All pull requests</Link>
          </p>
        </section>
      )}
    </main>
  );
}

function EmptySentence() {
  return (
    <div className="hk-state">
      <p>Nothing reviewed yet.</p>
      <p>
        <Link href="/connect">Connect a runner</Link> and{" "}
        <Link href="/prs">arm a pull request</Link>. The first review shows up here.
      </p>
    </div>
  );
}

function Figures({ allTime, thisMonth }: { allTime: Totals; thisMonth: Totals }) {
  return (
    <section className="hk-figures" aria-label="Totals">
      <div className="hk-figure">
        <span className="hk-figure-label">Reviews</span>
        <span className="hk-figure-value">{allTime.reviews}</span>
        <span className="hk-figure-note">{thisMonth.reviews} this month</span>
      </div>
      <div className="hk-figure">
        <span className="hk-figure-label">Pull requests reviewed</span>
        <span className="hk-figure-value">{allTime.pullRequests}</span>
        <span className="hk-figure-note">{thisMonth.pullRequests} this month</span>
      </div>
      <div className="hk-figure">
        <span className="hk-figure-label">Findings raised</span>
        <span className="hk-figure-value">{allTime.findings}</span>
        <span className="hk-figure-note">
          {allTime.addressed} addressed · {thisMonth.findings} this month
        </span>
      </div>
      <div className="hk-figure">
        <span className="hk-figure-label">
          <span className="hk-severity" data-severity="must_fix">
            Must fix
          </span>{" "}
          caught
        </span>
        <span className="hk-figure-value">{allTime.mustFix}</span>
        <span className="hk-figure-note">{thisMonth.mustFix} this month</span>
      </div>
      <div className="hk-figure">
        <span className="hk-figure-label">Cost</span>
        <span className="hk-figure-value">{hoursAndMinutes(allTime.seconds)}</span>
        <span className="hk-figure-note">
          {allTime.turns.toLocaleString("en")} turns · {hoursAndMinutes(thisMonth.seconds)} this
          month
        </span>
      </div>
    </section>
  );
}
