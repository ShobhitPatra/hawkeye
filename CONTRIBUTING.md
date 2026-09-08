# Contributing

Thanks for helping. Every pull request here is reviewed by Hawkeye itself before a maintainer reads it, so you will see the product working on your own change.

## Set up

```sh
pnpm install
docker compose up -d --wait db
pnpm --filter web db:migrate
```

Check your work with the same five commands CI runs:

```sh
pnpm lint
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

Run `pnpm format` before every commit. Add `--filter <package>` to any of them to run one package.

## Open an issue

- Use the issue forms: Bug for something Hawkeye does wrong, Feature for something it should do.
- For a bug, say what you did, what you expected, and what happened. Add a pull request link or the run's log lines, with tokens removed. Say whether it was the hosted instance, your own instance, or the runner, and the `hawkeye-review` version.
- For a feature, say what you cannot do today and why it matters. A rough idea of how it could work helps, but is not required.
- Search open issues first; add to an existing one instead of opening a duplicate.
- Security problems never go in an issue. Use the [security policy](SECURITY.md).

## Open a pull request

- One change per pull request. If you spot something else to fix, open an issue for it.
- Branch names describe the change: `feat/review-settings`, `fix/runner-reconnect`.
- Commit subjects look like `feat(web): subject` or `fix(runner): subject`. Scopes: `docs`, `core`, `runner`, `web`, `ci`. One short line, no body.
- Put tests next to the file they test. No snapshot tests.
- If your change makes any document wrong, fix the document in the same pull request.
- Fill in the pull request template: what, why, how, impact, test plan, scope.
- Coding standards are in [AGENTS.md](AGENTS.md); Hawkeye's review checks against them.

## Where things live

- `README.md`: the front door.
- `docs/design.md`: how Hawkeye works and why.
- `packages/core`: the review contract and rendering.
- `packages/runner`: the CLI and the daemon.
- `apps/web`: the control plane.

## Conduct and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems through the [security policy](SECURITY.md), not in a public issue.
