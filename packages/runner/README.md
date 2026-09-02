# hawkeye-review

The personal AI code reviewer. Runs on the Claude plan you already pay for — nothing for repo admins to install, no API key, nothing posted unless you connect the hosted dashboard.

Design, docs and source: https://github.com/ShobhitPatra/hawkeye

## Review a pull request in any agent session (read-only)

```sh
npx hawkeye-review prepare https://github.com/owner/repo/pull/123
# your agent session reads <round>/prompt.md, reviews the checkout, writes result.json
npx hawkeye-review show <round-dir>
```

Re-running `prepare` on the same pull request starts the next round: the prompt carries the previous findings, the interdiff, and your dismissals (`dismiss` / `undismiss`).

Needs Node 22+, git 2.31+, and a GitHub token (`--github-token`, `GITHUB_TOKEN`, or `gh auth token`).

## Connect a machine to a Hawkeye control plane

```sh
npx hawkeye-review runner login --url <control plane url>   # approve the code in the browser
npx hawkeye-review runner                                   # long-lived daemon on your Claude Code login
```

## License

MIT
