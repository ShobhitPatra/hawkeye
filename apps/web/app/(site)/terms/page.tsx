import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";

export const metadata = { title: "Terms, Hawkeye" };

export default function TermsPage() {
  return (
    <>
      <h1 className="hk-title">Terms</h1>
      <p className="hk-lede">
        The terms for using the hosted instance at hawkeye-review.vercel.app. The software itself is
        MIT licensed, and running your own instance is covered by that license alone.
      </p>
      <h2 className="hk-heading">What you get</h2>
      <p>
        A free, hosted control plane that queues a review for every pull request you open in a
        repository you linked, and for any other pull request you turn on, and posts the reviews on
        GitHub as the Hawkeye bot. Reviews start without a click, so each pull request you open
        spends your plan. It is offered as it is, without warranty of any kind, and it may change,
        pause or stop; when it stops, this page and the repository say so first.
      </p>
      <h2 className="hk-heading">What you are responsible for</h2>
      <ul>
        <li>
          Your coding agent's plan. The runner drives Claude Code or Codex on your machine under
          your own login, so staying within that plan's terms is yours to keep.
        </li>
        <li>
          Your repositories. Install the App, and link it, only where you may share the code with a
          reviewer running on your machine; every pull request you open there is reviewed until you
          pause it.
        </li>
        <li>
          Your runner tokens and sign-in. Revoke a token from the runners page if a machine is lost.
        </li>
      </ul>
      <h2 className="hk-heading">What a review is</h2>
      <p>
        A review is an opinion posted as a comment. It never approves, blocks or merges anything,
        and the decision on a pull request stays with its people.
      </p>
      <h2 className="hk-heading">Acceptable use</h2>
      <p>
        Do not use the instance to review repositories you have no right to, to attack it or the
        machines behind it, or to circumvent GitHub's or your plan's terms. Accounts that do are
        removed.
      </p>
      <h2 className="hk-heading">Changes and contact</h2>
      <p>
        These terms may change with the product; the repository's history records every change.
        Questions go to an issue on <a href={HAWKEYE_REPOSITORY_URL}>the repository</a>.
      </p>
    </>
  );
}
