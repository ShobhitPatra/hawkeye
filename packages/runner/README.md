# hawkeye-review

Code review on your own Claude or Codex plan. Reviews run under the Claude Code or Codex login already on your machine, so there is no API key. `prepare` and `show` are read-only, and the runner reports only to the control plane you connect.

Design, docs and source: https://github.com/ShobhitPatra/hawkeye

## Review a pull request in any agent session (read-only)

```sh
npx hawkeye-review prepare https://github.com/owner/repo/pull/123
# your agent session reads <round>/prompt.md, reviews the checkout, writes result.json
npx hawkeye-review show <round-dir>
```

`show` prints the verdict and one line per finding, and `--full` prints the whole review. Re-running `prepare` on the same pull request starts the next round: the prompt carries the previous findings, the interdiff, and your dismissals (`dismiss` / `undismiss`).

Needs Node 22+, git 2.31+, and a GitHub token (`--github-token`, `GITHUB_TOKEN`, or `gh auth token`).

## Review every push with the runner

```sh
npx hawkeye-review runner
```

Leave it running. The first run connects this machine: it opens the Connect page and waits while you type the code it prints there, then saves the runner token to `~/.config/hawkeye/runner.json` and starts. Turn reviews on for a pull request from the dashboard, and the runner reviews every push to it.

It connects to https://hawkeye.reviews unless you pass `--url` for your own control plane. `npx hawkeye-review runner login` connects again without starting, for example after the runner was removed.

Needs Node 22+, git 2.31+, and Claude Code or Codex installed and signed in.

## License

MIT
