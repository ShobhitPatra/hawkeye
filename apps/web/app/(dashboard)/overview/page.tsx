import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { loadOverview, type RecentReview } from "@/overview";
import { fillTitles } from "@/pull-request-titles";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { Suspense } from "react";
import { OverviewView, RecentReviews } from "./overview-view";

export default async function OverviewPage() {
  const session = await requireSession();
  const now = new Date();
  const [overview, runner] = await Promise.all([
    loadOverview(getDb(), session.user.id, now),
    requestRunnerStatus(session.user.id),
  ]);
  return (
    <OverviewView
      overview={overview}
      runner={runner}
      now={now}
      recent={
        <Suspense fallback={<RecentReviewsLoading count={overview.recent.length} />}>
          <RecentReviewsWithTitles recent={overview.recent} now={now} />
        </Suspense>
      }
    />
  );
}

async function RecentReviewsWithTitles({ recent, now }: { recent: RecentReview[]; now: Date }) {
  const titled = await fillTitles(getDb(), createGitHubAppClient({ fetch }), recent);
  return <RecentReviews recent={titled} now={now} />;
}

function RecentReviewsLoading({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <section className="hk-section" aria-labelledby="recent">
      <h2 className="hk-heading" id="recent">
        Recent reviews
      </h2>
      <div className="hk-skeleton" data-rows aria-hidden="true">
        {Array.from({ length: Math.min(count, 5) }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </section>
  );
}
