import Link from "next/link";
import { getDb } from "@/db";
import { formatUpdated } from "@/format-updated";
import { listRunners } from "@/runner-tokens";
import { requireSession } from "@/session";
import { CreateRunnerForm } from "./create-runner-form";
import { revokeRunnerAction } from "./actions";

function formatTimestamp(value: Date | null, now: number) {
  return value ? formatUpdated(value.toISOString(), now) : "never";
}

export default async function RunnersPage() {
  const session = await requireSession();
  const runners = await listRunners(getDb(), session.user.id);
  const now = Date.now();

  return (
    <main>
      <h1>Runners</h1>
      <p>A runner polls for review jobs with its own token. The token is shown once.</p>
      <p>
        <Link className="hk-link" href="/connect">
          Connect a runner
        </Link>{" "}
        from the command line instead.
      </p>
      <CreateRunnerForm />
      {runners.length === 0 ? (
        <p>No runners yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Last seen</th>
              <th>State</th>
              <th>Token</th>
            </tr>
          </thead>
          <tbody>
            {runners.map((runner) => (
              <tr key={runner.id}>
                <td>{runner.name}</td>
                <td>{formatTimestamp(runner.createdAt, now)}</td>
                <td>{formatTimestamp(runner.lastSeenAt, now)}</td>
                <td>{runner.revokedAt ? "revoked" : "active"}</td>
                <td>
                  {runner.revokedAt ? null : (
                    <form action={revokeRunnerAction}>
                      <input type="hidden" name="runnerId" value={runner.id} />
                      <button type="submit">Revoke</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
