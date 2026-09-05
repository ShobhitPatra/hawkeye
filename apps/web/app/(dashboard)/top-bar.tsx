import Link from "next/link";
import { describeRunnerStatus, type RunnerStatus } from "@/runner-status";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

export function TopBar({
  user,
  runner,
}: {
  user: { name: string; email: string };
  runner: RunnerStatus;
}) {
  const initial = user.name.slice(0, 1).toUpperCase();
  return (
    <header className="hk-topbar" data-sticky>
      <Link className="hk-wordmark" href="/overview">
        hawkeye
      </Link>
      <NavLinks />
      <div className="hk-topbar-end">
        {!runner.online && runner.waitingJobs > 0 && (
          <Link className="hk-status" data-state="attention" href="/runners">
            {describeRunnerStatus(runner)}
          </Link>
        )}
        <details className="hk-menu">
          <summary>
            <span className="hk-account-name">{user.name}</span>
            <span className="hk-account-initial">{initial}</span>
          </summary>
          <div className="hk-menu-panel">
            <div className="hk-menu-who">
              <b>{user.name}</b>
              {user.email}
            </div>
            <a href="https://github.com/settings/installations">Manage installation on GitHub</a>
            <SignOutButton />
          </div>
        </details>
      </div>
    </header>
  );
}
