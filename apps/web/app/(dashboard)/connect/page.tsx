import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { findRunnerLogin, sweepRunnerLogins } from "@/runner-login";
import { requestRunnerStatus } from "@/request-runner-status";
import { requireSession } from "@/session";
import { connectCommand } from "@/runner-command";
import { siteUrl } from "@/site-url";
import { ApproveLoginForm } from "./approve-login-form";
import { ApproveView, type LoginCodeState } from "./approve-view";
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
  const now = Date.now();

  if (code) {
    const codeState: LoginCodeState =
      !login || login.state === "expired"
        ? { state: "expired" }
        : login.state === "pending"
          ? {
              state: "pending",
              runnerName: login.runnerName,
              requested: formatUpdated(login.createdAt.toISOString(), now),
            }
          : { state: "approved", runnerName: login.runnerName };
    return <ApproveView code={codeState} form={<ApproveLoginForm />} />;
  }

  return (
    <ConnectView
      command={connectCommand(siteUrl())}
      approve={<ApproveLoginForm />}
      runner={await requestRunnerStatus(session.user.id)}
      now={now}
    />
  );
}
