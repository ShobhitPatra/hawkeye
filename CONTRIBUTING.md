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

## Open a pull request

- One change per pull request. If you spot something else to fix, open an issue for it.
- Branch names describe the change: `feat/review-settings`, `fix/runner-reconnect`.
- Commit subjects look like `feat(web): subject` or `fix(runner): subject`. Scopes: `docs`, `core`, `runner`, `web`, `ci`. One short line, no body.
- Put tests next to the file they test. No snapshot tests.
- If your change makes any document wrong, fix the document in the same pull request.
- Fill in the pull request template: what, why, how, impact, test plan, scope.

## Writing code

- Keep it small. Fix the cause, not the symptom.
- Functions fail fast on bad input; they never guess or silently fall back.
- No comments unless the code cannot say why. No comments that repeat the code.
- Reuse what the repository already has before adding a new way to do the same thing.
- No new dependencies without a reason, and never for a small feature.
- Never remove or rename anything in the `core` exports or the runner API. Add; do not break.

## Where things live

- `README.md`: the front door.
- `docs/design.md`: how Hawkeye works and why.
- `packages/core`: the review contract and rendering.
- `packages/runner`: the CLI and the daemon.
- `apps/web`: the control plane.

## Conduct and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems through the [security policy](SECURITY.md), not in a public issue.
