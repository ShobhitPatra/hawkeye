import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { localPath } from "@/local-path";
import { getSession } from "@/session";
import { CodeBlock } from "./code-block";
import { LandingHero } from "./landing-hero";
import { SignInButton } from "./sign-in-button";
import { CONTRIBUTING_URL, REVIEWS_URL, SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { parseTheme, THEME_COOKIE } from "@/theme";
import "./landing.css";

const PREPARE_COMMAND = "npx hawkeye-review prepare <pr-url>";

const CAUGHT: {
  pullRequest: number;
  url: string;
  severity: "must_fix" | "should_fix";
  claim: ReactNode;
  path: string;
  detail: ReactNode;
}[] = [
  {
    pullRequest: 260,
    url: "https://github.com/ShobhitPatra/hawkeye/pull/260#discussion_r4111551292",
    severity: "must_fix",
    claim: "The new fallback lets a user arm a pull request they did not author.",
    path: "apps/web/app/(dashboard)/prs/[owner]/[repo]/[number]/page.tsx:27",
    detail: (
      <>
        A signed-in user can enter coordinates for any PR reachable through an installation on that
        owner; the page exposes Turn reviews on, and <span className="hk-mono">armAction</span>{" "}
        checks only installation membership and PR reachability.
      </>
    ),
  },
  {
    pullRequest: 262,
    url: "https://github.com/ShobhitPatra/hawkeye/pull/262#discussion_r4111681774",
    severity: "should_fix",
    claim: "Concurrent claims can invalidate the replacement run they just handed out.",
    path: "apps/web/src/runner-api.ts:178",
    detail:
      "The stale job is requeued and its running runs are ended in separate committed statements; between them, another claim can take the job and create a new run that the first sweep then marks as an error.",
  },
  {
    pullRequest: 238,
    url: "https://github.com/ShobhitPatra/hawkeye/pull/238#discussion_r4103863493",
    severity: "should_fix",
    claim: (
      <>
        <span className="hk-mono">event.currentTarget</span> is null once{" "}
        <span className="hk-mono">await navigator.clipboard.writeText</span> has rejected, so the
        refused branch throws.
      </>
    ),
    path: "apps/web/app/(dashboard)/copy-button.tsx:50",
    detail: (
      <>
        React sets the synthetic event&apos;s <span className="hk-mono">currentTarget</span> back to
        null after the listener returns, and a rejected promise resumes after that.
      </>
    ),
  },
];

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
      <SiteHeader signedIn={false} {...signIn} />
      <main className="hk-page ld">
        <section className="ld-lead">
          <h1 className="hk-headline">Code review on your own Claude or Codex plan.</h1>
          <p className="hk-lede">
            A runner on your machine reads the whole repository, not just the diff, under your own
            login, and holds each change to your repository&apos;s own rules. Then it posts one
            verdict as <span className="hk-mono">hawkeye-review[bot]</span>: what breaks, where, and
            how to fix it.
          </p>
          <div className="hk-actions">
            <SignInButton {...signIn} variant="primary" size="large" />
          </div>
          <div className="ld-try">
            <span>Or try one review with no account:</span>
            <CodeBlock text={PREPARE_COMMAND} />
          </div>
        </section>

        <LandingHero />

        <section className="ld-h" aria-labelledby="gives">
          <h2 className="hk-heading" id="gives">
            What a review gives you
          </h2>
          <div className="ld-steps" data-plain>
            <div>
              <p className="hk-claim">A verdict that follows the findings.</p>
              <p className="hk-detail">
                Blocked only when something must be fixed, Changes needed when something should be.
                The model&apos;s own opinion never sets it.
              </p>
            </div>
            <div>
              <p className="hk-claim">Every finding with its file, line and fix.</p>
              <p className="hk-detail">
                No praise, no hedging, and silence where the code is fine.
              </p>
            </div>
            <div>
              <p className="hk-claim">Held to your repository&apos;s rules.</p>
              <p className="hk-detail">
                It reads <span className="hk-mono">AGENTS.md</span>,{" "}
                <span className="hk-mono">CLAUDE.md</span> and{" "}
                <span className="hk-mono">CONTRIBUTING.md</span>, then looks at intent, behavior,
                blast radius, verification, fit and hygiene.
              </p>
            </div>
            <div>
              <p className="hk-claim">It follows up on every push.</p>
              <p className="hk-detail">
                One comment, updated in place. Fixed findings resolve, only new ones are raised, and
                problems older than your change are marked Inherited and never block it.
              </p>
            </div>
          </div>
        </section>

        <section className="ld-h" aria-labelledby="caught">
          <h2 className="hk-heading" id="caught">
            What it caught on its own pull requests
          </h2>
          <p className="hk-body hk-prose">
            Three findings from Hawkeye&apos;s reviews of Hawkeye, each fixed before merge.{" "}
            <a href={REVIEWS_URL}>Every review is public</a>.
          </p>
          <div className="hk-margin">
            {CAUGHT.map((finding) => (
              <article
                key={finding.pullRequest}
                className="hk-entry"
                data-severity={finding.severity}
              >
                <div className="hk-gutter">
                  <span className="hk-label hk-severity" data-severity={finding.severity}>
                    {finding.severity === "must_fix" ? "Must fix" : "Should fix"}
                  </span>
                  <a className="hk-mono" href={finding.url}>
                    #{finding.pullRequest}
                  </a>
                </div>
                <div className="hk-entry-body">
                  <h3 className="hk-claim">{finding.claim}</h3>
                  <p className="hk-path">
                    <bdi>{finding.path}</bdi>
                  </p>
                  <p className="hk-detail">{finding.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

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
                Only the validated findings leave the machine; the checkout and your login stay
                there.
              </p>
            </div>
            <div>
              <p className="hk-claim">
                The comment lands as <span className="hk-mono">hawkeye-review[bot]</span>.
              </p>
              <p className="hk-detail">
                A comment and a passing commit status that carries the verdict, never a block.
                Merging stays your call.
              </p>
            </div>
          </div>
          <p className="ld-cap">
            Your plan&apos;s limits are the budget, and the dashboard shows what each review took in
            turns and minutes.
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
                hawkeye.reviews runs the same code you can read on GitHub. Sign in with GitHub,
                install the App, and it is yours.
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

        <SiteFooter theme={theme} />
      </main>
    </>
  );
}
