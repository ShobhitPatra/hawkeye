<picture>
  <source srcset=".github/banner-dark.svg" media="(prefers-color-scheme: dark)">
  <source srcset=".github/banner-light.svg" media="(prefers-color-scheme: light)">
  <img src=".github/banner-light.svg" alt="hawkeye. Code review on your own Claude Code or Codex plan." width="100%">
</picture>

<br>

Open a pull request. A runner on your machine reads every push with the coding agent you already pay for, under your own login, and posts one verdict as `hawkeye-review[bot]`. No token bill, no credentials in the cloud, and silence where the code is fine.

[Sign in with GitHub](https://hawkeye-review.vercel.app) to review every push, or try one review with no account:

```sh
npx hawkeye-review prepare https://github.com/owner/repo/pull/123
```

## A real review

The first round on this repository's own [pull request #87](https://github.com/ShobhitPatra/hawkeye/pull/87) is a review the bot posted: a verdict, one line per finding with the file and line, the lenses behind a disclosure, and the round in the footer. The [landing page](https://hawkeye-review.vercel.app) replays it from open to posted.

## What happens when you open a pull request

1. **Every push queues one job for its head.** Pushes collapse to the latest head, so a busy branch never piles up reviews. The hosted control plane holds only the queue, webhooks and findings.
2. **Your runner claims it and clones the branch.** One process on hardware you own. The control plane never sees a plan credential and never proxies model traffic.
3. **Your coding agent reviews it under your login.** Six lenses, four severities, one verdict. Only validated findings JSON leaves the machine.
4. **The comment lands as `hawkeye-review[bot]`.** A comment, never a block. On the next push, addressed findings resolve and only new ones are raised.

## What it costs

Nothing beyond the plan you already pay for. Your plan's limits are the budget, and the dashboard shows what each review cost in turns and minutes.

## What the runner can reach

A review runs a coding agent on your machine, as you, over code you did not write. Know what that means before you connect a runner.

- **What it can reach.** The agent runs shell commands to read and test the checkout, with your environment and your files in reach, not only the pull request. Anything your own terminal can read, change or run, a command it runs could too.
- **What it is denied.** Its file-editing, web-fetch and web-search tools are removed. The shell stays, so the first point holds in full: a command can still write a file or start a program. The checkout's own agent configuration (`CLAUDE.md`, `.claude/`) is removed before it starts and the repository's settings are never loaded, so a pull request cannot change the reviewer's tools or settings. The branch's `AGENTS.md`, `CLAUDE.md` and `CONTRIBUTING.md` are still read into the prompt as repository rules, fenced as untrusted text. The token that cloned the branch is never written into the checkout.
- **What bounds the risk today.** The runner reviews pull requests you open, in repositories you chose, so the exposure is code from the people who can push to your branches. `prepare` reviews whatever pull request URL you hand it, inside your own agent session and with that session's permissions: of the denials above, only the removal of the checkout's agent configuration applies there. Hand it code you would be willing to run. Reviewing strangers' pull requests waits for a sandbox around the shell ([#160](https://github.com/ShobhitPatra/hawkeye/issues/160)).

Run the runner on a machine, or under a user, whose files you are willing to have read by a program reviewing that code.

## Start with one pull request

1. Sign in with GitHub at [hawkeye-review.vercel.app](https://hawkeye-review.vercel.app) and install the GitHub App on a repository you admin.
2. On the machine where your coding agent is logged in, connect a runner and leave it running:

   ```sh
   npx hawkeye-review runner login --url https://hawkeye-review.vercel.app
   npx hawkeye-review runner
   ```

3. Open a pull request; it is reviewed on open and on every push.

The hosted instance shows every repository where the App is installed and your GitHub account has access. Claude Code works today; Codex support is the next release.

## Try one review with no account

`npx hawkeye-review prepare <pr-url>` fetches the pull request and writes the review prompt into a round directory. Open the prompt in any coding agent session, let it review the checkout, then run the `show` command it printed to read the verdict. Nothing is posted anywhere. It needs Node 22, git, and a GitHub token (`gh auth token` is enough).

## Open source, yours to run

- MIT licensed, and every pull request to this repository is reviewed by Hawkeye itself before a maintainer reads it.
- Run your own instance: the [self-hosting guide](docs/self-hosting.md) covers a Vercel deployment on Neon Postgres, or a single machine with Docker Compose.
- Read [how it works and why](docs/design.md), the [contributing guide](CONTRIBUTING.md), and the [security policy](SECURITY.md).
