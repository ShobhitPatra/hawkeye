import { CONTACT_EMAIL } from "@/contact";

export const metadata = { title: "Privacy, Hawkeye" };

export default function PrivacyPage() {
  return (
    <>
      <h1 className="hk-title">Privacy</h1>
      <p className="hk-lede">
        What the hosted instance at hawkeye.reviews keeps, what never reaches it, and how to have
        your data removed. Shobhit Patra runs the instance, as an individual in India. This page
        describes the code as it runs; the code is open, so you can check it.
      </p>
      <h2 className="hk-heading">What the control plane stores</h2>
      <ul>
        <li>
          Your GitHub account as GitHub reports it at sign-in: name, email, login, avatar URL, and
          the token GitHub issues at sign-in, stored encrypted. It is used only to ask GitHub which
          installations of the Hawkeye App your account can see, at sign-in and when the pull
          requests page loads, so they link to you. What keeps you signed in is the session below,
          and its cookie.
        </li>
        <li>
          Each session: when it was created, the IP address it was opened from, and the
          browser&apos;s user agent. Signing out deletes the session; one left to expire stays until
          your account is removed.
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
      </ul>
      <h2 className="hk-heading">What never reaches it</h2>
      <ul>
        <li>
          Your Claude Code or Codex credential, and the model traffic. The runner drives the coding
          agent on your machine under your own account, so the code the agent reads goes to
          Anthropic or OpenAI under your agreement with them, as when you use the agent yourself;
          the control plane never proxies it.
        </li>
        <li>
          Your repository. The runner clones it on your machine; only the validated findings JSON
          leaves it.
        </li>
        <li>Anything from the pages you see signed in. No analytics script runs on them.</li>
      </ul>
      <h2 className="hk-heading">Cookies</h2>
      <ul>
        <li>
          <span className="hk-mono">__Secure-better-auth.session_token</span> keeps you signed in.
          It is set at sign-in and lasts seven days, renewed while you use the site.
        </li>
        <li>
          <span className="hk-mono">__Secure-better-auth.state</span> ties the GitHub sign-in to the
          page that started it, and lasts five minutes.
        </li>
        <li>
          <span className="hk-mono">hawkeye-theme</span> remembers the theme you picked, and lasts a
          year. It is set only when you pick one.
        </li>
      </ul>
      <p>
        Each is needed for something you asked the site to do, so there is no consent banner.
        Nothing else sets a cookie, including the visit counting below.
      </p>
      <h2 className="hk-heading">Counting visits</h2>
      <p>
        The public pages, the landing and these Security, Privacy and Terms pages, count visits with
        Vercel Web Analytics. It sets no cookie; Vercel tells visitors apart by a hash of the
        request that changes every day and keeps no personal data. Each page&apos;s address is sent
        without its query, so a sign-in link that names a pull request is not reported.
      </p>
      <p>
        The operator also counts, from the rows listed above, how many accounts signed in, installed
        the App, connected a runner, had it come online and got a first review, by the week they
        signed in. Those counts never leave the database they are read from.
      </p>
      <h2 className="hk-heading">Where it lives</h2>
      <p>
        The control plane runs on Vercel and its database on Neon Postgres, both in the United
        States, in the us-east-1 region. GitHub receives the reviews the bot posts and the commit
        statuses it sets, under GitHub&apos;s own terms.
      </p>
      <h2 className="hk-heading">How long, and how to remove it</h2>
      <p>
        Data is kept while your account exists. Uninstalling the GitHub App stops every review for
        that installation and marks it deleted here. To have your account and everything under it
        removed, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on
        your GitHub account, with your GitHub login. It is done by hand within a week, and the reply
        says when. Reviews already posted stay on their pull requests, where you can delete them.
      </p>
      <h2 className="hk-heading">Your own instance</h2>
      <p>
        A self-hosted instance stores the same things on the servers you choose, and this page does
        not apply to it.
      </p>
      <h2 className="hk-heading">Changes and contact</h2>
      <p>
        This page changes with the code, and the repository&apos;s history records every change.
        Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </>
  );
}
