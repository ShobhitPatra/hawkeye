import Link from "next/link";
import { formatUpdated } from "@/format-updated";
import type { RunnerStatus } from "@/runner-status";

export function RunnerSentence({ runner, now }: { runner: RunnerStatus; now: number }) {
  if (runner.online)
    return (
      <div className="hk-state">
        <p>Runner online.</p>
      </div>
    );
  return (
    <div className="hk-state">
      <p>
        Runner{" "}
        <span className="hk-status" data-state="attention">
          offline
        </span>
        .{" "}
        {runner.waitingJobs > 0 ? (
          <>
            <Link href="/prs">
              {runner.waitingJobs} pull request{runner.waitingJobs === 1 ? " is" : "s are"} waiting
            </Link>{" "}
            and will be reviewed when it reconnects.
          </>
        ) : (
          "Nothing is waiting."
        )}
      </p>
      <p>
        {runner.lastSeenAt && (
          <>Last heartbeat {formatUpdated(runner.lastSeenAt.toISOString(), now)}. </>
        )}
        <Link href="/runners">Runners</Link>
      </p>
    </div>
  );
}
