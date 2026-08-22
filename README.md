# Hawkeye

**The personal code reviewer. Runs on the Claude or ChatGPT plan you already pay for. Arms onto any PR you choose. Nothing for repo admins to install.**

> The sharp-eyed one. `hawkeye[bot]` looks over every PR you arm.

Status: design stage, heading for open source. This README is the design document; nothing is built yet. Vocabulary lives in [`CONTEXT.md`](./CONTEXT.md); hard decisions in [`docs/adr/`](./docs/adr/).

---

## Thesis

Every AI code reviewer today is **paid per seat and installed per repo**: Copilot code review, Codex review, CodeRabbit, Greptile, Cursor Bugbot. They are products a team buys and an admin wires into a repository. Meanwhile most developers already pay for a Claude Max or ChatGPT plan that sits idle between coding sessions.

Hawkeye inverts the shape:

- **Personal, not repo-scoped.** It belongs to a developer, not a repository. It follows you: your own repos, your side projects, the OSS PR you sent this morning.
- **Bring your own plan.** The review runs on *your* Claude Code or Codex CLI, authenticated by *your* subscription, on *your* machine. Hawkeye never holds an API key and never meters tokens.
- **Arm, don't install.** Nothing happens until you arm a PR. Once armed, every push to it gets a review, with its own bot identity and inline comments, the way a team bot would.
- **Open source.** The hosted dashboard at the official instance is the easy path; the whole thing is self-hostable.

## The itch (where it started)

I open PRs in many repos: my own, my employer's, other people's OSS. I cannot ask every admin to install a reviewer. I do not want a second per-token bill for personal work when I already pay for Claude Max. And I do not want the review to post as *me*: a review I wrote and a review a bot wrote are different things to a maintainer, and to me.

What I wanted is the Copilot-code-review *feeling*, a reviewer with its own identity showing up with inline comments the moment I push, without GitHub being the one providing it and without anyone on the repo side lifting a finger. It turned out that itch is not specific to me.

## What Hawkeye is

Two halves (see [ADR-0001](./docs/adr/0001-split-brain-control-plane-and-user-runner.md)):

- **Control plane** — a hosted Next.js app with a small Postgres. GitHub App webhooks, the PR list across your repos, **Arm**, a job queue, run history, findings. It never runs a model and never sees a plan credential. You can use the official instance or `docker compose up` your own.
- **Runner** — one Node process on hardware you own (laptop daemon or a VPS image). It long-polls the control plane for jobs, clones the PR head into a temp worktree, runs the Claude Code CLI headless (`claude -p`) under your own login with a strict **review contract**, and returns validated findings JSON. The control plane renders and posts the review as `hawkeye[bot]` ([ADR-0002](./docs/adr/0002-control-plane-posts-reviews.md)).

Armable = any PR where the chosen identity can comment; the default list is PRs you authored.

## What Hawkeye is not

- Not a CI check. It never blocks a merge; it only comments (`COMMENT`, never `APPROVE` / `REQUEST_CHANGES`).
- Not a team reviewer. Hawkeye never carries company traffic on a personal subscription; teams should use a team product on an API gateway.
- Not an "AI reviews everything" bot. Nothing is reviewed until its owner arms it.
- Not a metered service. There is no token bill; your plan's limits are the budget and the dashboard shows what each review cost in turns and time.
- Not a place where subscription tokens live. The runner shells out to the official CLI on your machine; that is the whole credential story. Hawkeye never proxies, extracts, or forwards a subscription token.
- Not a model host. The model runs only on the user's own machine; the control plane never sees your code beyond what GitHub's webhook carries.

## Identity

GitHub only lets an account comment on a PR if that account has access to the repo. Copilot is "install-free" only because GitHub owns the platform. So ([ADR-0003](./docs/adr/0003-identity-github-app-first.md)):

| Where the PR lives | Identity Hawkeye posts as | Admin action needed |
|---|---|---|
| Repos/orgs you admin | The Hawkeye GitHub App — `hawkeye[bot]` on the official instance, `hawkeye-<handle>[bot]` on a self-hosted one | You install the App on your own repos once; you are the admin |
| Other people's **public** repos (your OSS PRs) — *later* | Your **machine user** (a second GitHub account you own), or yourself | None |

Other people's **private** repos are out of scope, deliberately: no reviewer can act there without the admin installing it. Resolution order: App installation exists on the repo → use it; else a configured machine user on a public repo → use it; else skip. Every review carries a footer crediting Hawkeye.

## Shape

```
GitHub App ─────── webhooks ──▶ Control plane   (Next.js + Postgres; Vercel+Neon or docker compose)
   installed on your repos          · PR list across your repos · Arm / disarm
                                    · armed PR + push → job (collapsed per PR to latest head, quiet window)
                                    · renders + posts reviews as hawkeye[bot], resolves addressed findings
                                    · runs, findings, turns used, runner status
                                           ▲                 │
                       findings JSON +     │                 │  runner long-polls /jobs
                       run events          │                 ▼  (runner token; no inbound ports)
                                   Runner   (one Node process, Docker-able; laptop → VPS)
                                     · shallow worktree of PR head (App installation token, 1h)
                                     · claude -p | codex exec under your own login
                                     · returns validated JSON; no GitHub credentials
```

## How a review runs

```
job: (repo, pr, head sha, base sha, previously reviewed sha?, open finding ids)
        │   starts after quiet window (default 3 min, 0 = immediate)
        ▼
 git worktree of PR head (shallow, temp) + base diff / interdiff, PR title/body, linked issue
        │
        ▼
 claude -p --output-format stream-json --max-turns N --append-system-prompt <contract>
   · contract: seven dimensions + JSON output schema + prior open findings
   · Stop hook: refuse to stop until the result file is written
   · tools: Read/Grep/Glob/Bash on the checkout; WebFetch/WebSearch denied
   · budget: max-turns 40, wall clock 15 min (per-user tunable)
        │
        ▼
 runner: parse + validate JSON (zod) → report to control plane
        │
        ▼
 control plane: stable finding ids (hash of file + normalized claim; line is metadata)
   · dedupe against findings already posted on this PR
   · resolved_ids from the model → reply "✓ addressed in <sha>" and resolve the thread
   · POST pulls/{n}/reviews as the bot identity, event COMMENT
       body: verdict + dimension table + non-line findings + credit footer
       comments[]: line-anchored findings, ```suggestion``` when an exact fix exists
```

Failures (CLI error, max-turns, invalid JSON, timeout) never touch the PR; they show in the dashboard with a retry.

## Review contract

Seven **dimensions**: necessity, correctness, tests, conventions, side effects, parity, governance. Finding classes: blocking / polish / pre-existing. Line-anchor only when the finding is about specific changed lines; `suggestion` only when an exact textual replacement fully fixes it. The prompt is repo-agnostic ("discover the repo's layout and conventions, don't assume them"); the target repo's own `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` are inlined at run time as repository rules for the conventions and governance dimensions to judge against. Any prompt that quotes PR bodies or issue text is injection-guarded.

Prompt overrides: a per-user override in the dashboard (taste), plus an optional `.hawkeye/REVIEW.md` in the repo (repo norms), appended when present.

## Triggers

- Arm reviews now, then on every `pull_request.synchronize` and `ready_for_review` to the armed PR. `reopened` does not trigger (head unchanged).
- `closed` / `merged` auto-disarms.
- Draft PRs can be armed; reviews start when ready unless the user opts in to draft reviews.
- Runner offline → jobs queue, collapsed per PR to the latest head; no expiry. Dashboard: "runner offline, N PRs waiting".

## Data model

`User` (GitHub identity) → `Runner` (token, last_seen; one per machine, revocable) · `Installation` (App install, account) · `ArmedPR` (repo, number, armed_by, quiet-window override) · `Job` (armed_pr, head_sha, base_sha, not_before, state queued/claimed/done/failed) · `Run` (job, runner, started/ended, turns, status, error) · `Finding` (armed_pr, stable_id, first_seen_sha, resolved_sha?, github_comment_id) · `ReviewPosted` (run, head_sha, github_review_id) · `UserSettings` (prompt override, max-turns, wall clock, quiet window).

Everything is scoped by `user_id` from day one; no orgs, teams, or roles.

## Principles

- **Credentials stay home.** The runner shells out to the user's own `claude` / `codex` CLI (`claude setup-token` for headless use). The control plane never sees a subscription credential and never proxies model traffic.
- **Arm, don't roam.** Nothing is reviewed until its owner arms it.
- **`COMMENT` only.** Hawkeye has opinions, not authority.
- **One review per head SHA**, findings deduped by stable id, interdiff on re-review, addressed findings resolved — a push never re-spams old findings.
- **Budget is the user's plan.** Turns and wall clock per run are visible in the dashboard.
- **Harness-agnostic.** Claude Code at launch; Codex second; one harness interface so a new CLI is a new file.
- **Plumbing never leaks onto the PR.** Failures are dashboard-only.

## Repo layout (planned)

TypeScript, pnpm monorepo: `packages/core` (contract, harness interface, render, dedupe, posting), `packages/runner` (CLI + daemon), `apps/web` (Next.js control plane).

## Milestones

1. **Runner alone, manual.** `hawkeye review <pr-url>` from a laptop: worktree → `claude -p` → findings → posted as `hawkeye[bot]` via the same `core` posting module, using a locally held App key. Proves contract and identity. Dogfood.
2. **Control plane + arm.** Next.js app with GitHub sign-in, App webhooks, PR list, Arm, jobs; runner becomes a daemon that long-polls with a copied runner token; reviews on every push with quiet window and interdiff; control plane posts.
3. **Multi-user + OSS release.** Official hosted instance, Codex harness, self-host docs (`docker compose`, App Manifest flow at `/setup`), public repo under MIT.
4. **Always-on + polish.** Runner Docker image for a VPS, device-code runner login, run history and budget view, re-review-now, machine-user identity for OSS PRs.

## Decisions

- Open source (MIT); official hosted instance run by the author; self-hostable end to end.
- Split brain: hosted control plane + user-owned runner; the model never runs hosted. ([ADR-0001](./docs/adr/0001-split-brain-control-plane-and-user-runner.md))
- Control plane posts; runner returns JSON only. ([ADR-0002](./docs/adr/0002-control-plane-posts-reviews.md))
- Identity: GitHub App first; `hawkeye[bot]` hosted, `hawkeye-<handle>[bot]` self-hosted; others' private repos out of scope; machine user later. ([ADR-0003](./docs/adr/0003-identity-github-app-first.md))
- Contributions: nothing Hawkeye posts counts toward the user's contribution graph. Accepted: bot identity over green squares.
- Trigger: arm from the dashboard, automatic on every push. Quiet window default 3 min.
- Hosting: Next.js + Postgres, deployable to Vercel + Neon and as a single Docker Compose. No Workers/D1 (locks self-hosters to one vendor).
- Runner ↔ control plane: long-poll with a runner token; results via POST. Clone with a 1h App installation token shipped in the job.
- Review contract: all seven dimensions by default; overrides per user and per repo.
- Subscription terms: the user is responsible for staying within their plan's terms; Hawkeye only drives the CLI they already run. Stated in this README and on the runner-setup page.

## Open questions

1. **Name collision.** "Hawkeye" is a common product name (and a Marvel character); fine for OSS. Register the `hawkeye` GitHub App slug and the `hawkeye-review` handle now; trademark check only if a paid tier ever appears.

## Name

**Hawkeye** — the sharp-eyed reviewer; reads naturally as `hawkeye[bot]`.

Availability check (2026-08-22): npm `hawkeye`, `hawkeye-bot`, `hawkeye-review` unclaimed; GitHub App slugs `hawkeye`, `hawkeye-bot`, `hawkeye-review`, `hawkeye-code-review`, `hawkeye-pr` show no public app (App names are globally unique including private apps, so confirm at creation time; `hawkeye-reviewer` and `hawkeye-app` are taken). GitHub usernames `hawkeye`, `hawkeye-bot`, `hawkeyebot`, `hawkeye-app`, `hawkeye-dev` are taken; `hawkeye-review`, `hawkeyereview`, `usehawkeye`, `hawkeyehq` are free. Domains: `hawkeye.dev/.app/.sh/.bot` resolve (taken); `hawkeye.review`, `hawkeyereview.com`, `hawkeyebot.com`, `gethawkeye.dev` have no DNS and are worth checking at a registrar.

Earlier candidates, kept for the record: Relook (the working name before this), Marginalia, Redpen, Squire, Rubric, Lookover, Pullwatch.
