import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";

export const metadata = { title: "Security, Hawkeye" };

export default function SecurityPage() {
  return (
    <>
      <h1 className="hk-title">Security</h1>
      <p className="hk-lede">
        Hawkeye handles GitHub App installation tokens, runner tokens and the review results of
        private repositories, so reports are taken seriously and handled privately.
      </p>
      <h2 className="hk-heading">Report a vulnerability</h2>
      <p>
        Use GitHub's private vulnerability reporting for this repository:{" "}
        <a href={`${HAWKEYE_REPOSITORY_URL}/security/advisories/new`}>open a private advisory</a>.
        Do not open a public issue for anything that could be a vulnerability.
      </p>
      <p>
        You get an acknowledgement within three days and a fix or a decision within thirty. Credit
        goes to the reporter in the release notes unless they prefer otherwise.
      </p>
      <h2 className="hk-heading">What is in scope</h2>
      <ul>
        <li>The control plane: sign-in, the GitHub App webhook, the runner API, token handling.</li>
        <li>The runner: the daemon, the review harness and the worktree it reviews in.</li>
        <li>The review contract: the fences around untrusted repository content in the prompt.</li>
        <li>The hosted instance at hawkeye-review.vercel.app.</li>
      </ul>
      <p>
        Findings that need physical access to a machine, or that only affect a self-hosted instance
        configured against the documentation, are welcome too and may be handled as hardening.
      </p>
      <h2 className="hk-heading">Supported versions</h2>
      <p>
        The latest published <span className="hk-mono">hawkeye-review</span> and the current main of
        the control plane. The full policy is{" "}
        <a href={`${HAWKEYE_REPOSITORY_URL}/blob/main/SECURITY.md`}>SECURITY.md</a> in the
        repository.
      </p>
    </>
  );
}
