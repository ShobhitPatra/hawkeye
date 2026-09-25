import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { localPath } from "@/local-path";
import { getSession } from "@/session";
import { CopyButton } from "./(dashboard)/copy-button";
import { LandingHero } from "./landing-hero";
import { RotatingWord } from "./rotating-word";
import { SignInButton } from "./sign-in-button";
import { CONTRIBUTING_URL, REVIEWS_URL, SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { parseTheme, THEME_COOKIE } from "@/theme";
import "./landing.css";

const PREPARE_COMMAND = "npx hawkeye-review prepare <pr-url>";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getSession();
  const returnTo = localPath((await searchParams).returnTo);
  if (session) redirect(returnTo && returnTo !== "/" ? returnTo : "/overview");
  const signIn = returnTo ? { callbackURL: returnTo } : {};
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <>
      <SiteHeader theme={theme} signedIn={false} {...signIn} />
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
            <SignInButton {...signIn} variant="primary" size="large" />
          </div>
          <div className="ld-try">
            <span>Or try one review with no account:</span>
            <div className="hk-code-row">
              <pre className="hk-code">{PREPARE_COMMAND}</pre>
              <CopyButton text={PREPARE_COMMAND} />
            </div>
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
              <p className="hk-claim">Your coding agent reviews it under your login.</p>
              <p className="hk-detail">
                Six lenses, four severities, one verdict. Only validated findings JSON leaves the
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

        <section className="ld-h" aria-labelledby="open-source">
          <h2 className="hk-heading" id="open-source">
            Open source, and reviewed by itself
          </h2>
          <div className="ld-steps" data-plain>
            <div>
              <p className="hk-claim">MIT licensed.</p>
              <p className="hk-detail">
                Every pull request to Hawkeye is reviewed by Hawkeye before a maintainer reads it.{" "}
                <a href={REVIEWS_URL}>Read the reviews</a>.
              </p>
            </div>
            <div>
              <p className="hk-claim">Hosted for you, in preview.</p>
              <p className="hk-detail">
                hawkeye-review.vercel.app runs the same code you can read on GitHub. Sign in with
                GitHub, install the App, and it is yours.
              </p>
            </div>
            <div>
              <p className="hk-claim">Contribute a lens, a harness, a fix.</p>
              <p className="hk-detail">
                Issues and pull requests are open; the{" "}
                <a href={CONTRIBUTING_URL}>contributing guide</a> and the{" "}
                <a href="/security">security policy</a> say how.
              </p>
            </div>
          </div>
        </section>

        <SiteFooter />
      </main>
    </>
  );
}
