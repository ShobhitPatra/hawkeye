# Contributing

Thanks for looking. Hawkeye is small on purpose, and every pull request here is reviewed by Hawkeye itself before a maintainer looks at it, so you will see the product working on your own change.

## Setup

```
pnpm install
docker compose up -d --wait db      # local Postgres for the control plane
pnpm --filter web db:migrate
```

Then `pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test` and `pnpm build`. CI runs the same five on every pull request. Scope a command to one package with `pnpm --filter <name>`.

## Pull requests

- One concern per pull request. If you find adjacent work, open an issue for it instead of widening the diff.
- Commits are conventional: `feat(scope): subject`, `fix(scope): subject`, `docs(scope): subject`, `test(scope): subject`; scopes are `docs`, `core`, `runner`, `web`, `ci`. One short subject line, no body.
- Branch names are descriptive (`feat/thread-scroll`, `fix/reconnect-backoff`).
- Run `pnpm format` before every commit; the formatter owns formatting.
- Tests sit beside the module they cover and import it by relative path. Cover the public seam and each branch of a parser, renderer or dedupe step. No snapshot tests.
- Update any documentation a change invalidates in the same pull request.

## Code

- Less is better. Fix the root cause; never mask a symptom by swapping a value, dropping a feature or widening a type.
- Public functions fail fast on invalid input. Leniency belongs only at an external boundary, and only where a specification prescribes it.
- No comments by default. Keep one only for a reason the code cannot express, written as a plain sentence.
- Build on what the repository already provides; a different approach needs a written reason.
- New dependencies need a justification, never for a minor feature, never commercially licensed.
- Shipped surfaces are append-only: the `core` exports and the runner to control plane HTTP contract gain fields and never lose or rename them.

## Where things are

`README.md` is the front door; `docs/design.md` is the design document and the reason behind most decisions. The review contract lives in `packages/core`, the CLI and daemon in `packages/runner`, the control plane in `apps/web`.

## Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Security reports go through the [security policy](SECURITY.md), never a public issue.
