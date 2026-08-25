import Link from "next/link";
import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { findRunnerLogin } from "@/runner-login";
import { runnerStatus } from "@/runner-status";
import { requireSession } from "@/session";
import { siteUrl } from "@/site-url";
import { ApproveLoginForm } from "./approve-login-form";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const session = await requireSession();
  const { code = "" } = await searchParams;
  const status = await runnerStatus(getDb(), session.user.id);
  const pending = code
    ? await findRunnerLogin(getDb(), { code }).catch(() => undefined)
    : undefined;

  return (
    <main>
      <h1>Connect a runner</h1>
      <p>On the machine that holds your Claude Code login, run:</p>
      <pre>
        <code>npx hawkeye runner login --url {siteUrl()}</code>
      </pre>
      <p>Then enter the code it shows and approve it.</p>
      {pending && (
        <p>
          {pending.state === "pending"
            ? `This code was requested ${formatUpdated(pending.createdAt.toISOString(), Date.now())} by a runner named "${pending.runnerName}". Approve it only if that is your machine.`
            : `This code is ${pending.state}.`}
        </p>
      )}
      <ApproveLoginForm code={code} />
      <h2>Runner status</h2>
      <p>
        {status.online ? "Runner online" : `Runner offline, ${status.waitingJobs} jobs waiting`}
      </p>
      <Link href="/runners">Runners</Link>
    </main>
  );
}
