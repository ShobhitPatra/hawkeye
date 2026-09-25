import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { loadOverview } from "@/overview";
import { fillTitles } from "@/pull-request-titles";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
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
        <RecentReviews
          recent={overview.recent}
          titles={fillTitles(getDb(), createGitHubAppClient({ fetch }), overview.recent)}
          now={now}
        />
      }
    />
  );
}
