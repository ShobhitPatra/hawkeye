<picture>
  <source srcset=".github/banner-dark.svg" media="(prefers-color-scheme: dark)">
  <source srcset=".github/banner-light.svg" media="(prefers-color-scheme: light)">
  <img src=".github/banner-light.svg" alt="hawkeye. Code review on your own Claude Code or Codex plan." width="100%">
</picture>

<br>

Hawkeye is a code reviewer that belongs to you, not to a repository. Open a pull request, and a runner on your machine reads every push with the coding agent you already pay for, under your own login, then posts one verdict as `hawkeye-review[bot]`.

- **What it costs:** nothing beyond that plan. No seat, no token bill.
- **Why it is different:** every other AI reviewer is bought per seat and wired into a repository by an admin. This one runs on your subscription, on your hardware. Your plan credential and your repository never reach a server of ours; only the findings do.
- **What it needs today:** a Claude Code login. Codex is next ([#170](https://github.com/ShobhitPatra/hawkeye/issues/170)).

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
- **What bounds the risk today.** The runner reviews pull requests you open, in repositories you chose, so the exposure is code from the people who can push to your branches. `prepare` reviews whatever pull request URL you hand it, inside your own agent session and with that session's permissions: the tool and settings denials above stop at the runner, while the removed agent configuration and the clone token kept out of the checkout apply there too. Hand it code you would be willing to run. Reviewing strangers' pull requests waits for a sandbox around the shell ([#160](https://github.com/ShobhitPatra/hawkeye/issues/160)).

Run the runner on a machine, or under a user, whose files you are willing to have read by a program reviewing that code.

## Start with one pull request

You need a machine with Node 22 or newer, git 2.31 or newer, and [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed and signed in (run `claude` once and check it answers). Nothing else is installed; `npx` fetches the runner each time.

1. **Sign in** with GitHub at [hawkeye-review.vercel.app](https://hawkeye-review.vercel.app).
2. **Install the GitHub App** on a repository you admin: open [github.com/apps/hawkeye-review](https://github.com/apps/hawkeye-review), choose Install, and pick the repositories. The App is how the review gets posted: it reads the repository and its pull requests, and writes review comments and commit statuses.
3. **Connect a runner** on that machine:

   ```sh
   npx hawkeye-review runner login --url https://hawkeye-review.vercel.app
   ```

   It prints a code and a link. Open the link, type the code, approve it. The terminal then says it is connected and where it saved its token.
4. **Start it and leave it running:**

   ```sh
   npx hawkeye-review runner
   ```

   The Runners page shows it online within a minute. If the machine sleeps or the terminal closes, reviews wait in the queue and run when it is back.
5. **Open a pull request** in a repository you installed the App on. Within a minute its checks show `hawkeye` as "Reviewing on <your machine>", and a few minutes later the review is posted as a comment. Every later push is reviewed again, and the same comment is updated in place.

To stop: Pause on the Pull requests page stops one pull request; Settings turns automatic review off for all of them; closing the terminal stops the runner.

If nothing happens, the Runners page says whether your runner is online, and each pull request's page on the dashboard lists its runs with the reason when one failed.

## Try one review with no account

`npx hawkeye-review prepare <pr-url>` fetches the pull request and writes the review prompt into a round directory. Open the prompt in any coding agent session, let it review the checkout, then run the `show` command it printed to read the verdict. Nothing is posted anywhere. It needs Node 22, git, and a GitHub token (`gh auth token` is enough).

## Open source, yours to run

- MIT licensed, and every pull request to this repository is reviewed by Hawkeye itself before a maintainer reads it.
- Run your own instance: the [self-hosting guide](docs/self-hosting.md) covers a Vercel deployment on Neon Postgres, the way the hosted instance runs. Docker Compose is there for development.
- Read [how it works and why](docs/design.md), the [contributing guide](CONTRIBUTING.md), and the [security policy](SECURITY.md).
