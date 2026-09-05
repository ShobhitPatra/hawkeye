import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { findRunnerLogin, sweepRunnerLogins } from "@/runner-login";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { siteUrl } from "@/site-url";
import { ApproveLoginForm } from "./approve-login-form";
import { ConnectView } from "./connect-view";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = "" } = await searchParams;
  const session = await requireSession(
    code ? `/connect?code=${encodeURIComponent(code)}` : "/connect",
  );
  const db = getDb();
  const login = code ? await findRunnerLogin(db, { code }) : undefined;
  await sweepRunnerLogins(db);
  const runner = await requestRunnerStatus(session.user.id);
  const now = Date.now();

  return (
    <ConnectView
      controlPlaneUrl={siteUrl()}
      {...(login
        ? {
            pending: {
              runnerName: login.runnerName,
              state: login.state,
              requested: formatUpdated(login.createdAt.toISOString(), now),
            },
          }
        : {})}
      approve={<ApproveLoginForm />}
      runner={runner}
      {...(runner.lastSeenAt
        ? { lastSeen: formatUpdated(runner.lastSeenAt.toISOString(), now) }
        : {})}
    />
  );
}
