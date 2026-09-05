import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { loadOverview } from "@/overview";
import { pullRequestTitles, titleKey } from "@/pull-request-titles";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { OverviewView } from "./overview-view";

export default async function OverviewPage() {
  const session = await requireSession();
  const now = new Date();
  const [overview, runner] = await Promise.all([
    loadOverview(getDb(), session.user.id, now),
    requestRunnerStatus(session.user.id),
  ]);
  const titles = await pullRequestTitles(createGitHubAppClient({ fetch }), overview.recent);
  const recent = overview.recent.map((review) => {
    const title = titles.get(titleKey(review));
    return title ? { ...review, title } : review;
  });
  return <OverviewView overview={{ ...overview, recent }} runner={runner} now={now} />;
}
