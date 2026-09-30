import { Fragment } from "react";
import type { InstalledAccount, InstalledOn } from "@/installed-on";

function Covers({ account }: { account: InstalledAccount }) {
  if (account.state === "suspended")
    return (
      <>
        <span className="hk-status" data-state="attention">
          Suspended
        </span>{" "}
        <span className="hk-muted">Reviews are stopped until the App is resumed on GitHub.</span>
      </>
    );
  if (account.state === "all") return <>All repositories</>;
  if (account.repositories.length === 0)
    return <span className="hk-muted">No repository you can reach</span>;
  return (
    <>
      {account.repositories.map((name, index) => (
        <Fragment key={name}>
          <span className="hk-unit">
            {name}
            {index < account.repositories.length - 1 && ","}
          </span>{" "}
        </Fragment>
      ))}
      {account.more > 0 && <span className="hk-unit hk-muted">and {account.more} more</span>}
    </>
  );
}

export function InstalledOnView({ installed }: { installed: InstalledOn }) {
  if (installed.accounts.length === 0)
    return (
      <div className="hk-state hk-arrive">
        <p>Hawkeye is not installed on a repository you can reach yet.</p>
        <p>
          <a href={installed.installUrl}>Install the GitHub App</a> on your account or an
          organisation you administer; its pull requests appear within a minute.
        </p>
      </div>
    );
  return (
    <>
      <dl className="hk-facts hk-arrive">
        {installed.accounts.map((account) => (
          <div key={account.id}>
            <dt>{account.login}</dt>
            <dd>
              <Covers account={account} />
              {account.manageUrl && (
                <>
                  {" "}
                  <span className="hk-muted">·</span>{" "}
                  <a className="hk-unit" href={account.manageUrl}>
                    Manage on GitHub
                  </a>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="hk-compact">
        <a href={installed.installUrl}>Install on another account</a>
      </p>
    </>
  );
}

export function InstalledOnFailed() {
  return (
    <div className="hk-state">
      <p>GitHub did not answer.</p>
      <p>Where Hawkeye is installed could not be read. Nothing changed; reload to try again.</p>
    </div>
  );
}

export function InstalledOnSkeleton() {
  return (
    <div className="hk-skeleton" data-rows aria-hidden="true" style={{ maxWidth: "40ch" }}>
      <span />
      <span />
      <span />
    </div>
  );
}
