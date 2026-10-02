import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { RUNNER_ONLINE_WINDOW_MS, reviewingByRunner } from "@/runner-status";
import { listRunners } from "@/runner-tokens";
import { requireSession } from "@/session";
import { connectCommand } from "@/runner-command";
import { siteUrl } from "@/site-url";
import { CreateRunnerForm } from "./create-runner-form";
import type { RunnerRowData } from "./runner-row";
import { RunnersView } from "./runners-view";

export default async function RunnersPage() {
  const session = await requireSession();
  const db = getDb();
  const [runners, reviewing] = await Promise.all([
    listRunners(db, session.user.id),
    reviewingByRunner(db, session.user.id),
  ]);
  const now = Date.now();

  const rows: RunnerRowData[] = runners.map((runner) => {
    const current = reviewing.get(runner.id);
    const online =
      runner.lastSeenAt !== null && now - runner.lastSeenAt.getTime() <= RUNNER_ONLINE_WINDOW_MS;
    return {
      id: runner.id,
      name: runner.name,
      state: runner.revokedAt ? "revoked" : online ? (current ? "reviewing" : "online") : "offline",
      ...(current ? { pullRequest: `${current.owner}/${current.repo} #${current.number}` } : {}),
      lastSeen: runner.lastSeenAt ? formatUpdated(runner.lastSeenAt.toISOString(), now) : "never",
      created: formatUpdated(runner.createdAt.toISOString(), now),
    };
  });

  return (
    <RunnersView
      runners={rows}
      connectCommand={connectCommand(siteUrl())}
      create={<CreateRunnerForm controlPlaneUrl={siteUrl()} />}
    />
  );
}
