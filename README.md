<p><img src=".claude/skills/hawkeye-design/mark.svg" width="20" alt=""> <code>hawkeye</code></p>

# Hawkeye

A code reviewer that runs on your own Claude subscription and comments on your pull requests.

You open a pull request. A small program on your computer reads it with Claude Code, using the login you already have, and the review appears on the pull request as a comment from `hawkeye-review[bot]`: a verdict, then what to fix and where. When there is nothing to fix, it says so in one line.

No API key. No extra bill. Nobody in the middle: the model runs on your machine, and the server only keeps the queue and the results.

## What a review looks like

> ### Changes needed
>
> **AGENTS.md still says CI runs test and build on every PR.** `AGENTS.md:18`
> This change makes that false for docs-only pull requests. Update the line in the same pull request.

That is from a real review of this repository's own [pull request #109](https://github.com/ShobhitPatra/hawkeye/pull/109).

## Try it once, no account needed

```sh
npx hawkeye-review prepare https://github.com/owner/repo/pull/123
```

This downloads the pull request and writes a review prompt. Open that prompt in any AI coding session (Claude Code, Codex, Cursor), let it review the code, then run the `show` command it printed to read the verdict. Nothing is posted anywhere. You need Node 22, git, and a GitHub token (`gh auth token` is enough).

## Review every push

1. Sign in with GitHub at [hawkeye-review.vercel.app](https://hawkeye-review.vercel.app) and install the GitHub App on your repositories.
2. On the computer where Claude Code is logged in, run `npx hawkeye-review runner login --url https://hawkeye-review.vercel.app` and approve the code it shows.
3. Run `npx hawkeye-review runner` and leave it open.
4. On the dashboard, turn on reviews for a pull request. From then on, every push to it is reviewed, and the comment is updated in place.

The hosted site is a preview: today it lists only the repositories where you installed the App yourself ([#48](https://github.com/ShobhitPatra/hawkeye/issues/48) opens it up). You can also run everything yourself; see the [self-hosting guide](docs/self-hosting.md).

## What it costs

Nothing beyond your Claude plan. The dashboard shows what each review used, in turns and minutes.

## More

- [How it works and why](docs/design.md)
- [Contributing](CONTRIBUTING.md) and the [security policy](SECURITY.md)
- [MIT license](LICENSE)
