import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { findRunnerLogin, sweepRunnerLogins } from "@/runner-login";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { siteUrl } from "@/site-url";
import { ApproveLoginForm, type LoginCodeState } from "./approve-login-form";
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

  const codeState: LoginCodeState | undefined = !code
    ? undefined
    : !login || login.state === "expired"
      ? { state: "expired" }
      : login.state === "pending"
        ? {
            state: "pending",
            runnerName: login.runnerName,
            requested: formatUpdated(login.createdAt.toISOString(), now),
          }
        : { state: "approved", runnerName: login.runnerName };

  return (
    <ConnectView
      controlPlaneUrl={siteUrl()}
      approve={<ApproveLoginForm prefill={code} {...(codeState ? { code: codeState } : {})} />}
      runner={runner}
      now={now}
    />
  );
}
