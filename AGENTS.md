# Hawkeye

Personal AI code reviewer: a hosted control plane plus a per-user runner that reviews armed pull requests on the user's own Claude/Codex plan and posts as a bot identity. Design lives in `docs/design.md`; `README.md` is the public front door.

## Structure

```
README.md          front door; docs/design.md is the design document
workspace/         local-only scratch, ADRs, agent-skill config (gitignored)
packages/core      review contract, harness interface, render, dedupe, posting
packages/runner    hawkeye CLI (daemon in milestone 2)
apps/web           Next.js control plane (Drizzle + Postgres)
.claude/skills     agent skills; hawkeye-design carries the design system (SKILL.md, stylesheet.css, the mark) and is a build input of apps/web, which imports its stylesheet; the served favicon copies live in apps/web/public
```

## Commands

pnpm install · pnpm lint (oxlint) · pnpm format (oxfmt; run before every commit) · pnpm typecheck · pnpm test (vitest) · pnpm build (tsup). CI (`.github/workflows/ci.yml`) runs install, lint, format:check, typecheck, test and build as the steps of one job, `checks`. Until 2026-10-01 it runs only when started by hand (`gh workflow run ci.yml --ref <branch>`): the private repository ran out of included Actions minutes, so every gate runs locally before each push, with raw exit codes, and the workflow is started by hand for a change to a migration, the runner loop, review posting or the wire contract. After the reset it goes back to every PR, with `checks` as the one required status. One job, because a private repository bills each job rounded up to a whole minute. Scope to one package with pnpm --filter <name>. Control plane: `pnpm --filter web dev|build|db:generate|db:migrate|auth:generate`, `docker compose up -d --wait db` (local Postgres). The web build fetches IBM Plex from Google Fonts through next/font, so it needs network access.

## Rules

- One concern per PR. Adjacent work goes to a follow-ups list, not into the diff.
- Commits: conventional style — `feat(scope): subject`, `fix(scope): subject`, `docs(scope): …`, `test(scope): …`; `chore:` and `docs:` may be bare when no scope is evident. Pick scopes from the repo's top-level areas and list them. Single short subject line, no body, no trailers of any kind.
  - Scopes: `docs`, `core`, `runner`, `web`, `ci`.
- Branch names: clean, public, descriptive (`feat/thread-scroll`, `fix/reconnect-backoff`) — never ticket numbers or internal IDs.
- Repro tests are temporary; contract tests at public seams stay.
- Comments: only constraints the code cannot express; no history, no restating the code.
- Local docs and ideas are never committed. Scratch notes, ideas, specs, and tickets go in `workspace/`, which is gitignored.

## Coding standards

- Less is better. Solve the root cause, never mask a symptom (no swapping a value, dropping a feature, or widening a type to make an error go away). Simple is correct.
- Public APIs fail fast: throw on invalid input, never coerce or silently fall back. Leniency only at an external boundary (wire, user input) and only where a spec prescribes it.
- Zero comments by default. Keep one only for a *why* no reader could recover from the code (hidden invariant, upstream workaround, non-obvious constraint), written as a neutral declarative sentence. Never comment history, formatting, or what the code already says.
- Don't add defensive checks the toolchain already enforces (type system, strict null checks, linter). Don't hand-format — the formatter owns formatting; run it before every commit.
- Build on what the framework/repo already provides; never introduce a parallel mechanism for something that exists. Follow how the repo already solves a problem; a different approach needs a written reason, not preference.
- No new dependencies casually — a dep needs justification; never for a minor feature; never commercially-licensed.
- Shipped surfaces are append-only: the `core` package exports and the runner ↔ control plane HTTP contract. Re-point a moved export, never remove one; add fields, never rename or drop them.
- Tests: colocated beside the module, import by relative path, cover the public seam and each branch of a parser, renderer, or dedupe step; no snapshot tests; mocks spread the original and override only what the test needs.
- Names: TypeScript idiom (camelCase values, PascalCase types, UPPER_SNAKE constants); no abbreviations, no internal IDs in identifiers.
- Keep docs in lockstep with code in the same PR: anything a change invalidates gets updated in that PR, not the next.
