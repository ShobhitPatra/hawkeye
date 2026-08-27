# Hawkeye

**The personal code reviewer. Runs on the Claude or ChatGPT plan you already pay for. Arms onto any PR you choose. Nothing for repo admins to install.**

> The sharp-eyed one. `hawkeye[bot]` (currently `hawkeye-review[bot]`; the `hawkeye` slug is reserved for the hosted instance) looks over every PR you arm.

Status: milestone 1 shipped (`hawkeye review <pr-url>`), heading for open source. This README is the design document; see "Run it" below.

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

Two halves:

- **Control plane** — a hosted Next.js app with a small Postgres. GitHub App webhooks, the PR list across your repos, **Arm**, a job queue, run history, findings. It never runs a model and never sees a plan credential. You can use the official instance or `docker compose up` your own.
- **Runner** — one Node process on hardware you own (laptop daemon or a VPS image). It long-polls the control plane for jobs, clones the PR head into a temp worktree, runs the Claude Code CLI headless (`claude -p`) under your own login with a strict **review contract**, and returns validated findings JSON. The control plane renders and posts the review as `hawkeye[bot]`.

Armable = any PR where the chosen identity can comment; the default list is PRs you authored.

## What Hawkeye is not

- Not a CI check. It never blocks a merge; it only comments (`COMMENT`, never `APPROVE` / `REQUEST_CHANGES`).
- Not a team reviewer. Hawkeye never carries company traffic on a personal subscription; teams should use a team product on an API gateway.
- Not an "AI reviews everything" bot. Nothing is reviewed until its owner arms it.
- Not a metered service. There is no token bill; your plan's limits are the budget and the dashboard shows what each review cost in turns and time.
- Not a place where subscription tokens live. The runner shells out to the official CLI on your machine; that is the whole credential story. Hawkeye never proxies, extracts, or forwards a subscription token.
- Not a model host. The model runs only on the user's own machine; the control plane never sees your code beyond what GitHub's webhook carries.

## Identity

GitHub only lets an account comment on a PR if that account has access to the repo. Copilot is "install-free" only because GitHub owns the platform. So:

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
job: (repo, pr, head sha, merge base sha, previously reviewed sha?, open finding ids)
        │   starts after quiet window (default 3 min, 0 = immediate)
        ▼
 git worktree of PR head (shallow, temp; its CLAUDE.md and .claude/ are captured as repository rules, then removed) + diff from the merge base / interdiff (lockfiles and build output excluded), PR title/body, linked issue
        │
        ▼
 claude -p --output-format stream-json … (prompt on stdin; contract is the prompt)
   · contract: six lenses + JSON output schema + prior open findings
   · Stop hook: refuse to stop until the result file is written
   · tools: bypassPermissions; Edit/Write/NotebookEdit/WebFetch/WebSearch removed with --disallowedTools; Bash runs with the user's environment and filesystem, not only the checkout
   · budget: turns (harness-enforced, default 40), wall clock 15 min (per-user tunable)
        │
        ▼
 runner: parse + validate JSON (zod) → report to control plane
        │
        ▼
 control plane: stable finding ids (hash of file + normalized claim; line is metadata)
   · dedupe against findings already posted on this PR
   · resolved_ids from the model → reply "✓ addressed in <sha>" and resolve the thread
   · POST pulls/{n}/reviews as the bot identity, event COMMENT
       body: verdict + all findings (anchored ones as one-liners) + collapsed lens table + credit footer
       comments[]: line-anchored findings, ```suggestion``` when an exact fix exists
```

Failures (CLI error, max-turns, invalid JSON, timeout) never touch the PR; they show in the dashboard with a retry.

## Review contract

Six **lenses**, each assessed once: **intent** (does the change do what the PR and linked issue say, and only that), **behavior** (logic, edge cases, failure modes, races, broken invariants), **blast radius** (public surface, configuration, migrations, performance, security, dependencies), **verification** (are the changed behaviours proven by meaningful tests at the right seam), **fit** (this repository's own rules and patterns), **hygiene** (commit quality, docs in lockstep, licensing, secrets, anything a maintainer must gate on). Finding severities, defined by consequence: must-fix (security, data loss, a broken promise of the PR, a crash on a realistic path), should-fix (incorrect or unsafe for a realistic case, or a trap for the next change), optional (the PR is correct without it), inherited (a problem in code the PR touches but did not introduce). Verdict is derived from the worst finding when the result is parsed (the model's own verdict is kept beside it as `reportedVerdict`): blocked (any must-fix), changes needed (any should-fix), mergeable (only optional or inherited), ship (nothing found). Line-anchor only when the finding is about specific changed lines; `suggestion` only when an exact single-line replacement fully fixes it. Lenses render as a table with paragraph-length assessments inside a collapsed drop-down, and the body lists every finding grouped by severity — anchored ones as a single line marked `(inline)`. Findings stay short — a one-line claim plus at most two sentences of detail — and any longer reasoning or evidence goes in an optional `rationale`, collapsed under "why". The prompt is repo-agnostic ("discover the repo's layout and conventions, don't assume them"); the target repo's own `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` are inlined at run time as repository rules for the fit and hygiene lenses to judge against. Any prompt that quotes PR bodies or issue text is injection-guarded.

Contract override: a private contract file replaces the built-in lens and finding rules while the untrusted-data fences, repository rules, diff and JSON output schema stay. The runner reads `--contract <path>`, else `HAWKEYE_CONTRACT_PATH`, else `~/.config/hawkeye/contract.md` when it exists.

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

## Run it

### Runner (milestone 1)

1. Register a GitHub App (permissions: pull requests read/write, contents read, issues read, metadata read; no webhook), generate a private key, install it on your repos.
2. `~/.config/hawkeye/config.json`: `{ "appId": <id>, "appSlug": "<app-slug>", "privateKeyPath": "~/.config/hawkeye/app.pem" }` (`~` is expanded; env overrides: `HAWKEYE_APP_ID`, `HAWKEYE_APP_SLUG`, `HAWKEYE_APP_PRIVATE_KEY_PATH`).
3. `pnpm install && pnpm build`, then `node packages/runner/dist/bin.js review <pr-url> [--dry-run] [--force] [--contract <path>]`.
4. Optional: put your own review contract at `~/.config/hawkeye/contract.md` (or point `HAWKEYE_CONTRACT_PATH` at it, or pass `--contract <path>`) to replace the built-in lens and finding rules.

Reviews post as `<app-slug>[bot]` (the author's instance: `hawkeye-review[bot]`). Run artifacts land in `~/.cache/hawkeye/runs/`.

### Review locally in any agent session

Three commands let any agent session (any model) review a pull request with the Hawkeye contract, without the control plane, a harness, or posting. `node packages/runner/dist/bin.js prepare <pr-url> [--github-token <token>] [--contract <path>] [--root <dir>]` fetches the pull request, checks its head out, and writes the review prompt into a round directory; the session reads `prompt.md`, reviews the checkout, and writes `result.json`; `node packages/runner/dist/bin.js show <round-dir>` validates that file, derives the verdict, and prints the review as plain text (exit code 0 whenever the result parses; the verdict is information, not a failure).

The token is `--github-token`, else `GITHUB_TOKEN`, else `gh auth token`; without one `prepare` stops with a message. It is only used to read the pull request, its linked issue and the merge base, and to clone; nothing is ever posted. Rounds live under `~/.cache/hawkeye/reviews/<owner>/<repo>/<number>/round-<N>/` (`--root` moves them): `prompt.md`, `checkout/` (the PR head, with its `CLAUDE.md`, `CLAUDE.local.md` and `.claude/` removed), `meta.json` (round number, head, base and merge base shas, start time, pull request coordinates), and `result.json` once the session has written it. `prepare` prints four lines: `round <N> for owner/repo#n at <head7>` (with ` (after round <M> at <head7>)` when the round follows an earlier one), the round directory, the checkout directory, and the result path; the prompt names the checkout directory so the session reviews it wherever it was opened from. Rounds accumulate per pull request (N = 1 + the highest existing round) so an earlier round's findings stay readable; only the `checkout/` of older rounds is removed, after the new one is in place.

A second `prepare` on the same pull request reviews against the previous round: the highest round with a parsed `result.json` (a round without one, or with a broken one, is skipped with a warning on stderr). Its checkout also fetches that round's head, and the prompt gains a `# Previous round` section with the earlier findings and their stable ids, the interdiff (`git diff <previous head>..HEAD`, same exclusions as the diff; an unchanged head is stated instead of an empty diff, and when the previous head was rewritten away by a force-push the prompt says so and the round reviews the full diff with the prior findings as context), and the rules for the round: report every prior finding in `priorFindings` as `addressed`, `open` or `withdrawn` with a note, repeat still-open findings in `findings` with the same path and claim so the id stays stable, and raise new findings only about what the interdiff changed or newly exposed. `meta.json` records `previousRound` and `previousHeadSha`. `node packages/runner/dist/bin.js dismiss <round-dir> <finding-id> <reason>` records in that round's `dismissed.json` that a finding is not going to be acted on (the id must be one of that round's findings); every later round's prompt carries the reason, even after a round has reported the finding as withdrawn and asks for the finding to be reported as `withdrawn` unless the interdiff proves the reason wrong. `show` prints a `Prior findings:` list when the result has one and ends with a `Rounds:` table over every round of the pull request (round, head, verdict or `pending`, start time). The token reaches git through an environment variable (`--config-env`) as an `Authorization` header, so it is never written into the checkout's configuration and never appears on a command line (git 2.31 or newer).

### Runner daemon (milestone 2, in progress)

On the machine that holds your Claude Code login: `node packages/runner/dist/bin.js runner login --url <control plane url> --token <runner token from /runners>` once (stored in `~/.config/hawkeye/runner.json`; env overrides `HAWKEYE_CONTROL_PLANE_URL`, `HAWKEYE_RUNNER_TOKEN`), then `node packages/runner/dist/bin.js runner` to loop: claim a job, clone the PR with the one-hour token the job carries, run Claude Code with the review contract, heartbeat, report the result. `--once` handles a single job and exits non-zero when three claims in a row fail or the result cannot be delivered; the daemon waits a second after an empty poll, retries a failed claim after five seconds, and retries a failed result report three times (2 s, 4 s, 8 s) before logging it and moving on (the control plane requeues a claim that stops heartbeating). `--contract <path>` overrides the built-in contract (else the job's per-user override, else the default). The daemon never posts to GitHub; the control plane does. It needs Node 22+, git 2.31 or newer and the `claude` CLI signed in; it holds no GitHub credentials of its own.

### Control plane (milestone 2, in progress)

Local: `docker compose up -d --wait db`, copy `apps/web/.env.example` to `apps/web/.env`, `pnpm --filter web db:migrate`, `pnpm --filter web dev`.
Sign-in uses the GitHub App's OAuth client: in the App settings set the callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github`, generate a client secret, and grant the account permission Email addresses: read (Better Auth needs an email; GitHub hides private ones otherwise). Webhook: in the App settings enable the webhook with URL `<BETTER_AUTH_URL>/api/github/webhook` and a secret (`GITHUB_WEBHOOK_SECRET`), and subscribe to Installation and Pull request events; delivery needs a public URL, so locally you can only replay signed payloads or forward deliveries through a tunnel. Pull request deliveries drive reviews: a push to an armed PR (`synchronize` and `ready_for_review`) queues a job for the new head after the quiet window (armed override, else the user setting, else 180s), replacing any job still waiting; drafts are skipped unless the user opted into reviewing drafts; closing or merging the PR disarms it for everyone and cancels any job still waiting; `reopened` does not trigger. Env (see `apps/web/.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`. `GITHUB_APP_PRIVATE_KEY` holds the PEM contents of the App's private key, with newlines written either literally or as `\n`; minting installation tokens to list an installation's repositories and pull requests needs the App permissions Contents: read and Pull requests: read; posting reviews needs Pull requests: read and write.
`/runners` manages runner tokens: create one (the `hk_…` token is shown once, only its hash is stored), see when each runner was last seen, revoke one. `/connect` is the other way to get a token: it shows the login command (`node packages/runner/dist/bin.js runner login --url <control plane url>` until the CLI is published), a form to type and approve the code that command prints (the link the CLI prints carries the code so the page can describe the pending login, but the code is typed, never prefilled), and whether a runner is online (a non-revoked runner seen within 90 s) or offline with the number of queued jobs waiting. Behind it is a device-code flow with two unauthenticated endpoints: `POST /api/runner/login` with `{ name }` starts a login and returns 201 `{ code, deviceSecret, verifyUrl, expiresAt, intervalSeconds }` (the code is `XXXX-XXXX`, the login expires after 10 minutes); `POST /api/runner/login/collect` with `{ deviceSecret }` returns 200 `{ status: "pending" }` until the code is approved on `/connect`, then 200 `{ status: "approved", token }` exactly once (the runner and its token are created at that moment, so no token is ever stored), then 410 `{ status: "expired" }`, as it does for an unknown secret or a login past its time; expired logins are deleted whenever a login starts, a lapsed one is collected, or `/connect` loads, a collected login is deleted on the spot, and when 1000 logins are open the oldest is evicted to make room (a per-client rate limit at the edge is the hosted deployment's job), and `/connect` shows the runner name and age of a pending code before the Approve button. The device secret is the only credential, so the endpoints are not rate limited yet; a login only ever yields a token for the signed-in user who typed the code. With that token a runner drives the job API: `GET /api/runner/jobs` long-polls for up to 25s and returns the claimed job with a fresh installation token, the pull request coordinates and the user's review settings (or 204 when nothing is queued), `POST /api/runner/jobs/<id>/heartbeat` keeps the claim alive (a claim without a heartbeat for 5 minutes goes back to the queue), `POST /api/runner/runs/<id>/events` accepts `{ type, at, data }` entries and counts the `turn` ones, and `POST /api/runner/runs/<id>/result` posts `{ status, turns, result?, error?, commentable? }`, which stores the review result and closes the run and the job. For an `ok` result the control plane renders the review (inline comments on the lines the runner reported as `commentable`, the rest in the body) and posts it on the pull request as `hawkeye-review[bot]`; one review per head, recorded in `review_posted`, so a second run for the same head posts nothing; each finding is also stored in `finding` under its stable id with the head it was first seen on and the head it disappeared on, unless a newer job for the pull request has already completed, in which case the older result is reported as `superseded` and leaves the rows alone, and a repeat run of the same arm for a head it already posted is reported as `already-posted` and leaves them alone too; a recording error is logged and reported as `failed` without affecting the posted review. A failed post keeps the result and records the error on the run; the response says `posted`, `already-posted` or `failed`.
`/prs` lists the open pull requests you authored across your installations, with Arm/Disarm per row (arming queues a review job for the PR's current head straight away, and marks it for review on every later push); after upgrading, sign out and in once so your GitHub login is stored. The app resolves `@hawkeye/core` through the workspace link to its built `dist`, so `pnpm --filter @hawkeye/core build` (or `pnpm build`) has to run before `next dev` or `next build`; `pnpm --filter web typecheck` checks against core's sources and needs no build.
Hosted: a Vercel project with a Neon Postgres and the same env, configured with Root Directory `apps/web`, Install Command `pnpm install` (pnpm installs the whole workspace from any package in it) and Build Command `pnpm --filter @hawkeye/core build && pnpm build` (both run from `apps/web`; the filter finds the workspace root on its own). Run `pnpm --filter web db:migrate` against Neon before the first deploy.

## Milestones

1. **Runner alone, manual.** `hawkeye review <pr-url>` from a laptop: worktree → `claude -p` → findings → posted as `hawkeye[bot]` via the same `core` posting module, using a locally held App key. Proves contract and identity. Dogfood. (shipped: `hawkeye review <pr-url>`)
2. **Control plane + arm.** Next.js app with GitHub sign-in, App webhooks, PR list, Arm, jobs; runner becomes a daemon that long-polls with a copied runner token; reviews on every push with quiet window and interdiff; control plane posts.
3. **Multi-user + OSS release.** Official hosted instance, Codex harness, self-host docs (`docker compose`, App Manifest flow at `/setup`), public repo under MIT.
4. **Always-on + polish.** Runner Docker image for a VPS, device-code runner login, run history and budget view, re-review-now, machine-user identity for OSS PRs.

## Decisions

- Open source (MIT); official hosted instance run by the author; self-hostable end to end.
- Split brain: hosted control plane + user-owned runner; the model never runs hosted.
- Control plane posts; runner returns JSON only.
- Identity: GitHub App first; `hawkeye[bot]` hosted, `hawkeye-<handle>[bot]` self-hosted; others' private repos out of scope; machine user later.
- Contributions: nothing Hawkeye posts counts toward the user's contribution graph. Accepted: bot identity over green squares.
- Trigger: arm from the dashboard, automatic on every push. Quiet window default 3 min.
- Hosting: Next.js + Postgres, deployable to Vercel + Neon and as a single Docker Compose. No Workers/D1 (locks self-hosters to one vendor).
- Runner ↔ control plane: long-poll with a runner token; results via POST. Clone with a 1h App installation token shipped in the job.
- Review contract: all six lenses by default; overrides per user and per repo.
- Subscription terms: the user is responsible for staying within their plan's terms; Hawkeye only drives the CLI they already run. Stated in this README and on the runner-setup page.

## Open questions

1. **Name collision.** "Hawkeye" is a common product name (and a Marvel character); fine for OSS. Register the `hawkeye` GitHub App slug and the `hawkeye-review` handle now; trademark check only if a paid tier ever appears.

## Name

**Hawkeye** — the sharp-eyed reviewer; reads naturally as `hawkeye[bot]`.

Availability check (2026-08-22): npm `hawkeye`, `hawkeye-bot`, `hawkeye-review` unclaimed; GitHub App slugs `hawkeye`, `hawkeye-bot`, `hawkeye-review`, `hawkeye-code-review`, `hawkeye-pr` show no public app (App names are globally unique including private apps, so confirm at creation time; `hawkeye-reviewer` and `hawkeye-app` are taken). GitHub usernames `hawkeye`, `hawkeye-bot`, `hawkeyebot`, `hawkeye-app`, `hawkeye-dev` are taken; `hawkeye-review`, `hawkeyereview`, `usehawkeye`, `hawkeyehq` are free. Domains: `hawkeye.dev/.app/.sh/.bot` resolve (taken); `hawkeye.review`, `hawkeyereview.com`, `hawkeyebot.com`, `gethawkeye.dev` have no DNS and are worth checking at a registrar.

Earlier candidates, kept for the record: Relook (the working name before this), Marginalia, Redpen, Squire, Rubric, Lookover, Pullwatch.
