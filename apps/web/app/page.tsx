import { redirect } from "next/navigation";
import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { localPath } from "@/local-path";
import { getSession } from "@/session";
import { LandingHero } from "./landing-hero";
import { Mark } from "./mark";
import { RotatingWord } from "./rotating-word";
import { SignInButton } from "./sign-in-button";
import "./landing.css";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getSession();
  const returnTo = localPath((await searchParams).returnTo);
  if (session) redirect(returnTo && returnTo !== "/" ? returnTo : "/overview");
  const signIn = returnTo ? { callbackURL: returnTo } : {};
  return (
    <>
      <header className="hk-topbar">
        <a className="hk-wordmark hk-lockup" href="/">
          <Mark />
          hawkeye
        </a>
        <div className="hk-topbar-end">
          <a href={HAWKEYE_REPOSITORY_URL}>Source</a>
          <SignInButton {...signIn} />
        </div>
      </header>
      <main className="hk-page ld">
        <section className="ld-lead">
          <h1 className="hk-headline">
            Code review on your own <RotatingWord /> plan.
          </h1>
          <p className="hk-lede">
            Open a pull request. A runner on your machine reads every push with your own login and
            posts one verdict as <span className="hk-mono">hawkeye[bot]</span>. No token bill, no
            credentials in the cloud, and silence where the code is fine.
          </p>
          <div className="hk-actions">
            <SignInButton {...signIn} variant="primary" />
          </div>
          <div className="ld-try">
            <span>Or try one review with no account:</span>
            <code>npx hawkeye-review prepare &lt;pr-url&gt;</code>
          </div>
        </section>

        <LandingHero />

        <section className="ld-h" aria-labelledby="how">
          <h2 className="hk-heading" id="how">
            What happens when you open a pull request
          </h2>
          <div className="ld-steps">
            <div>
              <p className="hk-claim">Every push queues one job for its head.</p>
              <p className="hk-detail">
                Pushes collapse to the latest head, so a busy branch never piles up reviews. The
                hosted control plane holds only the queue, webhooks and findings.
              </p>
            </div>
            <div>
              <p className="hk-claim">Your runner claims it and clones the branch.</p>
              <p className="hk-detail">
                One process on hardware you own. The control plane never sees a plan credential and
                never proxies model traffic.
              </p>
            </div>
            <div>
              <p className="hk-claim">Claude Code reviews it under your login.</p>
              <p className="hk-detail">
                Six lenses, three severities, one verdict. Only validated findings JSON leaves the
                machine.
              </p>
            </div>
            <div>
              <p className="hk-claim">
                The comment lands as <span className="hk-mono">hawkeye[bot]</span>.
              </p>
              <p className="hk-detail">
                A comment, never a block. On the next push, addressed findings resolve and only new
                ones are raised.
              </p>
            </div>
          </div>
        </section>

        <section className="ld-h" aria-labelledby="cost">
          <h2 className="hk-heading" id="cost">
            What it costs
          </h2>
          <p className="hk-body hk-prose">
            Nothing beyond the plan you already pay for. Your plan's limits are the budget, and the
            dashboard shows what each review cost in turns and minutes.
          </p>
        </section>

        <section className="ld-h" aria-labelledby="start">
          <h2 className="hk-heading" id="start">
            Start with one pull request
          </h2>
          <div className="hk-actions">
            <SignInButton {...signIn} variant="primary" />
            <a className="hk-button" href={HAWKEYE_REPOSITORY_URL}>
              Read the source
            </a>
          </div>
          <p className="ld-cap">
            Install the GitHub App on a repo you admin, start the runner on your machine, open a
            pull request.
          </p>
        </section>

        <footer className="ld-foot">
          <span className="hk-mono hk-lockup">
            <Mark />
            hawkeye
          </span>
          <a href={HAWKEYE_REPOSITORY_URL}>Source, MIT</a>
          <a href={`${HAWKEYE_REPOSITORY_URL}#run-it`}>Self-host with docker compose</a>
          <a href="https://www.npmjs.com/package/hawkeye-review">npm: hawkeye-review</a>
          <span className="ld-foot-end">Claude Code today, Codex next.</span>
        </footer>
      </main>
    </>
  );
}
