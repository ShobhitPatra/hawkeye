import Link from "next/link";
import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { findRunnerLogin, sweepRunnerLogins } from "@/runner-login";
import { requestRunnerStatus } from "@/request-runner-status";
import { describeRunnerStatus } from "@/runner-status";
import { requireSession } from "@/session";
import { siteUrl } from "@/site-url";
import { ApproveLoginForm } from "./approve-login-form";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code = "" } = await searchParams;
  const session = await requireSession(
    code ? `/connect?code=${encodeURIComponent(code)}` : "/connect",
  );
  const pending = code ? await findRunnerLogin(getDb(), { code }) : undefined;
  await sweepRunnerLogins(getDb());
  const status = await requestRunnerStatus(session.user.id);

  return (
    <main>
      <h1>Connect a runner</h1>
      <p>On the machine that holds your Claude Code login, run:</p>
      <pre>
        <code>npx hawkeye-review runner login --url {siteUrl()}</code>
      </pre>
      <p>Then type the code it shows and approve it.</p>
      {pending &&
        (pending.state === "pending" ? (
          <p>
            Requested {formatUpdated(pending.createdAt.toISOString(), Date.now())} by a runner named{" "}
            <code>{pending.runnerName}</code>. Approve it only if that is your machine.
          </p>
        ) : (
          <p>This code is {pending.state}.</p>
        ))}
      <ApproveLoginForm />
      <h2>Runner status</h2>
      <p>{describeRunnerStatus(status)}</p>
      <Link href="/runners">Runners</Link>
    </main>
  );
}
