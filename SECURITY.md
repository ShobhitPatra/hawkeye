# Security policy

Hawkeye handles GitHub App installation tokens, runner tokens and the review results of private repositories, so reports are taken seriously and handled privately.

## Reporting a vulnerability

Report through GitHub's private vulnerability reporting: https://github.com/ShobhitPatra/hawkeye/security/advisories/new. Do not open a public issue for anything that could be a vulnerability.

You will get an acknowledgement within three days and a fix or a decision within thirty. Credit goes to the reporter in the release notes unless they prefer otherwise.

## Scope

- The control plane (`apps/web`): sign-in, the GitHub App webhook, the runner API, token handling.
- The runner (`packages/runner`): the daemon, the review harness and the worktree it reviews in.
- The review contract (`packages/core`): prompt fences around untrusted repository content.

Findings about the hosted instance at https://hawkeye-review.vercel.app are in scope. Findings that need physical access to a user's machine, or that only affect a self-hosted instance configured against the documentation, are still welcome but may be handled as hardening rather than as a vulnerability.

## Supported versions

The latest published `hawkeye-review` and the current `main` of the control plane.
