import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";

export const metadata = { title: "Privacy, Hawkeye" };

export default function PrivacyPage() {
  return (
    <>
      <h1 className="hk-title">Privacy</h1>
      <p className="hk-lede">
        What the hosted instance at hawkeye-review.vercel.app keeps, what never reaches it, and how
        to have your data removed. This page describes the code as it runs; the code is open, so you
        can check it.
      </p>
      <h2 className="hk-heading">What the control plane stores</h2>
      <ul>
        <li>
          Your GitHub account as GitHub reports it at sign-in: name, email, login, avatar URL, and
          the sign-in token GitHub issues, which is used only to keep you signed in.
        </li>
        <li>
          Each session: when it was created, the IP address it was opened from, and the browser's
          user agent.
        </li>
        <li>
          The GitHub App installations you link, by id, with the login and type of the account they
          belong to.
        </li>
        <li>
          The pull requests with reviews on, as owner, repository and number: every pull request you
          open in a repository the App is installed on and you have linked, which is turned on for
          you when GitHub reports it opened, or ready for review if it opened as a draft, and any
          you turn on yourself. Each carries your settings for it, and your account-wide review
          settings, including any prompt text you add. Pausing a pull request on the dashboard keeps
          its row and stops its reviews.
        </li>
        <li>
          Each review job and run: when it ran, on which runner, how many turns it took, whether it
          failed and why, and the review result the runner returned. The result holds the findings,
          which quote lines of your code where a finding sits.
        </li>
        <li>The ids of the reviews posted on GitHub, and each finding under a stable id.</li>
        <li>
          Runner tokens as a hash only, with the runner's name and when it was last seen. The token
          itself is shown once and never stored.
        </li>
        <li>Two cookies: your session, and your theme choice.</li>
      </ul>
      <h2 className="hk-heading">What never reaches it</h2>
      <ul>
        <li>
          Your Claude Code or Codex credential. The runner drives the coding agent on your machine,
          and the control plane never proxies model traffic.
        </li>
        <li>
          Your repository. The runner clones it on your machine; only the validated findings JSON
          leaves it.
        </li>
        <li>
          Analytics. There is no tracking script and no third-party analytics. The operator counts,
          from the rows listed above, how many accounts signed in, installed the App, connected a
          runner, had it come online and got a first review, by the week they signed in. The counts
          never leave the database they are read from.
        </li>
      </ul>
      <h2 className="hk-heading">Where it lives</h2>
      <p>
        The control plane runs on Vercel and its database on Neon Postgres. GitHub receives the
        reviews the bot posts and the commit statuses it sets, under GitHub's own terms.
      </p>
      <h2 className="hk-heading">How long, and how to remove it</h2>
      <p>
        Data is kept while your account exists. Uninstalling the GitHub App stops every review for
        that installation and marks it deleted here. To have your account and everything under it
        removed,{" "}
        <a href={`${HAWKEYE_REPOSITORY_URL}/issues/new`}>open an issue on the repository</a> from
        the GitHub account in question; it is done by hand within a week.
      </p>
      <h2 className="hk-heading">Your own instance</h2>
      <p>
        A self-hosted instance stores the same things on the servers you choose, and this page does
        not apply to it.
      </p>
    </>
  );
}
