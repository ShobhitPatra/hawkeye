<p><img src=".claude/skills/hawkeye-design/mark.svg" width="20" alt=""> <code>hawkeye</code></p>

# Hawkeye

Code review on your own Claude plan. Open a pull request; a runner on your machine reads every push with your own login, and a review lands on the pull request as `hawkeye-review[bot]`: the verdict first, then findings with paths and lines, and silence where the code is fine.

Nothing for repository admins to install, no API key, no model traffic through anyone's server. The hosted control plane holds the queue, the webhooks and the findings; the model runs where your login is.

Status: preview. The hosted instance at [hawkeye-review.vercel.app](https://hawkeye-review.vercel.app) reviews the author's own repositories today; sign-in for other GitHub accounts is the next change ([#48](https://github.com/ShobhitPatra/hawkeye/issues/48)). Self-hosting works now. The CLI is [`hawkeye-review`](https://www.npmjs.com/package/hawkeye-review) on npm.

## Try one review with no account

```sh
npx hawkeye-review prepare https://github.com/owner/repo/pull/123
```

It checks the pull request out and writes the review prompt into a round directory. Any agent session reads the prompt, reviews the checkout and writes `result.json`; `npx hawkeye-review show <round-dir>` prints the verdict and one line per finding. Nothing is posted. Needs Node 22, git 2.31 and a GitHub token (`--github-token`, `GITHUB_TOKEN`, or `gh auth token`).

## Run it on every push

1. Sign in with GitHub on the control plane and install the GitHub App on the repositories you want reviewed.
2. On the machine that holds your Claude Code login, run `npx hawkeye-review runner login --url <control plane url>` once and approve the code in the browser.
3. Leave `npx hawkeye-review runner` running. It claims a job, clones the pull request with a one-hour token the job carries, runs Claude Code with the review contract, and returns findings as JSON. The control plane posts the review.
4. Turn reviews on for a pull request from the dashboard. Every later push is reviewed after a short quiet window; the review is edited in place, addressed findings are marked, and only new findings get new inline comments.

What each review cost, in turns and minutes, is on the dashboard. The budget is your plan's limits; you are responsible for staying within your plan's terms, and Hawkeye only drives the CLI you already run.

## Self-host

The control plane is a Next.js app on Postgres, deployable to Vercel with a Neon database, or with Docker Compose. See the [design document's run section](docs/design.md#run-it) until the self-hosting guide lands.

## How it reviews

Six lenses (intent, behavior, blast radius, verification, fit, hygiene), severities defined by consequence (must fix, should fix, optional, inherited), one verdict (ship, mergeable, changes needed, blocked). A finding states what breaks and what to do; a review that finds nothing says so in one line. Repository content in the prompt is fenced as untrusted, and the checkout's agent instructions are removed before the review. The full contract, the data model and every decision are in the [design document](docs/design.md).

## Principles

- The model never runs hosted. The runner returns JSON; the control plane posts.
- The reviewer is a bot identity. Nothing Hawkeye posts counts toward your contribution graph.
- Shipped surfaces are append-only: the core exports and the runner to control plane contract only grow.
- Open source under MIT; the hosted instance is one deployment of the same code.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Every pull request here is reviewed by Hawkeye before a maintainer reads it. Security reports go through the [security policy](SECURITY.md).

## License

[MIT](LICENSE)
