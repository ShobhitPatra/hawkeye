# Hawkeye

**The personal code reviewer. Runs on the Claude or ChatGPT plan you already pay for. Arms onto any PR you choose. Nothing for repo admins to install.**

> The sharp-eyed one. `hawkeye[bot]` (currently `hawkeye-review[bot]`; the `hawkeye` slug is reserved for the hosted instance) looks over every PR you arm.

Status: milestone 2 in progress; the CLI is published as [`hawkeye-review`](https://www.npmjs.com/package/hawkeye-review) on npm. This is the design document; the README is the front door.

## Contents

**Why** — [Thesis](#thesis) · [The itch](#the-itch) · [What Hawkeye is](#what-hawkeye-is) · [What Hawkeye is not](#what-hawkeye-is-not)

**How it works** — [Identity](#identity) · [Shape](#shape) · [How a review runs](#how-a-review-runs) · [The review contract](#the-review-contract) · [Triggers](#triggers)

**Architecture** — [Data model](#data-model) · [The runner channel](#the-runner-channel) · [Principles](#principles)

**Running it** — [Repo layout](#repo-layout) · [The runner CLI](#the-runner-cli) · [Reviewing locally](#reviewing-locally-in-any-agent-session) · [The runner daemon](#the-runner-daemon) · [The control plane](#the-control-plane)

**Status** — [Milestones](#milestones) · [Decisions](#decisions) · [Open questions](#open-questions) · [Name](#name)

---

# Why

## Thesis

Every AI code reviewer today is **paid per seat and installed per repo**: Copilot code review, Codex review, CodeRabbit, Greptile, Cursor Bugbot. They are products a team buys and an admin wires into a repository. Meanwhile most developers already pay for a Claude Max or ChatGPT plan that sits idle between coding sessions.

Hawkeye inverts the shape:

- **Personal, not repo-scoped.** It belongs to a developer, not a repository. It follows you: your own repos, your side projects, the OSS PR you sent this morning.
- **Bring your own plan.** The review runs on *your* Claude Code or Codex CLI, authenticated by *your* subscription, on *your* machine. Hawkeye never holds an API key and never meters tokens.
- **Arm, don't install.** Nothing happens until you arm a PR. Once armed, every push to it gets a review, with its own bot identity and inline comments, the way a team bot would.
- **Open source.** The hosted dashboard at the official instance is the easy path; the whole thing is self-hostable.

## The itch

I open PRs in many repos: my own, my employer's, other people's OSS. I cannot ask every admin to install a reviewer. I do not want a second per-token bill for personal work when I already pay for Claude Max.

And a review I wrote and a review a bot wrote are different things — to a maintainer, and to me. That difference has to survive however the review reaches the pull request. Where the App is installed, a bot identity carries it. Where it is not, the review goes out under the account of the person who asked for it, and **the footer is what keeps the distinction honest**: every review says what produced it, so nothing is ever passed off as hand-written.

What I wanted is the Copilot-code-review *feeling*, a reviewer with its own identity showing up with inline comments the moment I push, without GitHub being the one providing it and without anyone on the repo side lifting a finger. It turned out that itch is not specific to me.

## What Hawkeye is

Two halves.

**Control plane** — a hosted Next.js app with a small Postgres. GitHub App webhooks, the PR list across your repos, **Arm**, a job queue, run history, findings. It never runs a model and never sees a plan credential. You can use the official instance or `docker compose up` your own.

**Runner** — one Node process on hardware you own (laptop daemon or a VPS image). It long-polls the control plane for jobs, clones the PR head into a temp worktree, runs the Claude Code CLI headless (`claude -p`) under your own login with a strict [review contract](#the-review-contract), and returns validated findings JSON. The control plane renders and posts the review.

Armable = any PR where the chosen identity can comment; the default list is PRs you authored.

## What Hawkeye is not

- **Not a CI check.** It never blocks a merge; it only comments (`COMMENT`, never `APPROVE` / `REQUEST_CHANGES`).
- **Not a team reviewer.** Hawkeye never carries company traffic on a personal subscription; teams should use a team product on an API gateway.
- **Not an "AI reviews everything" bot.** Nothing is reviewed until its owner arms it.
- **Not a metered service.** There is no token bill; your plan's limits are the budget and the dashboard shows what each review cost in turns and time.
- **Not a place where subscription tokens live.** The runner shells out to the official CLI on your machine; that is the whole credential story. Hawkeye never proxies, extracts, or forwards a subscription token.
- **Not a model host.** The model runs only on the user's own machine; the control plane never sees your code beyond what GitHub's webhook carries.

---

# How it works

## Identity

GitHub only lets an account comment on a PR if that account has access to the repo. Copilot is "install-free" only because GitHub owns the platform. Hawkeye has two identities and no others:

| Where the PR lives | Posts as | Admin action needed |
|---|---|---|
| A repo with the Hawkeye App installed | The App — `hawkeye[bot]` on the official instance (currently `hawkeye-review[bot]`), `hawkeye-<handle>[bot]` on a self-hosted one | The App is installed once, by whoever admins the repo |
| Any other PR you can see *(planned, milestone 4)* | **You**, the person who asked for the review | None |

**Resolution order:** an App installation exists on the repo → post as the bot; else → post as the requesting user. There is no third case and no machine user.

Only the first row exists today: every trigger is an App webhook, the clone token is an installation token, and the control plane posts with one. The second row needs all three replaced, and its credential is undecided — see [open question 3](#open-questions).

Posting as the user is what makes a review possible on a repo nobody will install an App on — your employer's monorepo, a public project you contribute to but do not maintain. It works because Hawkeye only ever posts `COMMENT`: GitHub's code review limits restrict *approving* and *requesting changes* to accounts with explicit access, while commenting stays open to anyone who can see the pull request.

Two consequences follow, and both are deliberate:

- **Private repos are in scope where you are a collaborator.** Read access is enough to review. A private repo you cannot see stays out of scope; nothing can act there.
- **A review posted as you counts as your GitHub activity.** It appears in your review history like any review you wrote by hand. The footer is what distinguishes it, so the footer is not optional — it is the honesty mechanism, and every review carries it.

## Shape

```
GitHub App ─────── webhooks ──▶ Control plane   (Next.js + Postgres; Vercel+Neon or docker compose)
   installed on your repos          · PR list across your repos · Arm / disarm
                                    · armed PR + push → job (collapsed per PR to latest head, quiet window)
                                    · renders + posts reviews, resolves addressed findings
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
        │   starts after quiet window (default 0 s)
        ▼
 git worktree of PR head (shallow, temp; its CLAUDE.md and .claude/ are captured as repository
 rules, then removed) + diff from the merge base / interdiff (lockfiles and build output
 excluded), PR title/body, linked issue
        │
        ▼
 claude -p --output-format stream-json …   (prompt on stdin; the contract is the prompt)
   · contract: six lenses + JSON output schema + prior open findings
   · Stop hook: refuse to stop until the result file is written
   · tools: bypassPermissions; Edit/Write/NotebookEdit/WebFetch/WebSearch removed with
     --disallowedTools; Bash runs with the user's environment and filesystem, not only the checkout
   · budget: turns (harness-enforced, default 40), wall clock 15 min (per-user tunable) over the
     whole job: the pull request fetch and the clone run under it too, and the harness gets what is
     left, so a hung clone ends the run as a timeout instead of holding the claim forever
        │
        ▼
 runner: parse + validate JSON (zod) → report to control plane
        │
        ▼
 control plane: stable finding ids (hash of file + normalized claim; line is metadata)
   · dedupe against findings already posted on this PR
   · resolved_ids from the model → reply "✓ addressed in <sha>" and resolve the thread
   · POST pulls/{n}/reviews as the resolved identity, event COMMENT
```

**The posted review** carries the verdict word as a heading, its one-line reason, and findings grouped under Must fix / Should fix / Optional / Inherited — anchored ones say "Posted inline at the line". Below that sit the prior findings, the collapsed rounds and lens tables, and a credit footer with the round and turn count. Line-anchored findings go out as `comments[]`, with a ```suggestion``` block when an exact fix exists.

**The body has a size budget.** GitHub refuses a review body over 65,536 characters, and a living review that crossed it could never be updated again. The renderer keeps the body under 64,000 (the margin holds the reviewing block a later claim prepends) by leaving things out in a fixed order until it fits: round rows older than the newest ten collapse into one row, closed prior findings become a count, every round but the current one collapses, the lens table goes, then Optional, Should fix and finally every finding shrinks to its one-line claim with its id. The verdict, its reason, every open finding's claim and the footer always stay. If nothing fits, or GitHub still answers 422, the control plane posts a short form (verdict, reason, counts by severity, a sentence that the full findings are on the dashboard) and notes it on the run; a short form refused too fails the round with GitHub's message.

**While it runs**, the living review shows a "Reviewing on \<runner\>" badge (animated, served at `/status/reviewing`); the first round posts that as a placeholder review that the result then fills. A run that fails or is superseded replaces the line with one sentence.

**The commit status** `hawkeye` on the head is pending "Reviewing on \<runner\>" from the moment the job is claimed, then success with the verdict and finding count. A run that fails ends it as success "Review did not complete" — never failure or error: the status informs, it never blocks.

Failures (CLI error, max-turns, invalid JSON, timeout) never touch the PR; they show in the dashboard with a retry.

## The review contract

### Six lenses, each assessed once

| Lens | Asks |
|---|---|
| **Intent** | Does the change do what the PR and linked issue say, and only that? |
| **Behavior** | Logic, edge cases, failure modes, races, broken invariants |
| **Blast radius** | Public surface, configuration, migrations, performance, security, dependencies |
| **Verification** | Are the changed behaviours proven by meaningful tests at the right seam? |
| **Fit** | This repository's own rules and patterns |
| **Hygiene** | Commit quality, docs in lockstep, licensing, secrets, anything a maintainer must gate on |

### Four severities, defined by consequence

| Severity | Means |
|---|---|
| **Must fix** | Security, data loss, a broken promise of the PR, a crash on a realistic path |
| **Should fix** | Incorrect or unsafe for a realistic case, or a trap for the next change |
| **Optional** | The PR is correct without it |
| **Inherited** | A problem in code the PR touches but did not introduce |

### Verdict

Derived from the worst finding when the result is parsed; the model's own verdict is kept beside it as `reportedVerdict`.

| Verdict | When |
|---|---|
| **Blocked** | Any must-fix |
| **Changes needed** | Any should-fix |
| **Mergeable** | Only optional or inherited |
| **Ship** | Nothing found |

### Anchoring and length

Line-anchor only when the finding is about specific changed lines; `suggestion` only when an exact single-line replacement fully fixes it. Findings stay short — a one-line claim plus at most two sentences of detail — and any longer reasoning or evidence goes in an optional `rationale`, collapsed under "why". Lenses render as a table with paragraph-length assessments inside a collapsed drop-down.

### Repository rules

The prompt is repo-agnostic: *discover the repo's layout and conventions, don't assume them*. The target repo's own `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` are inlined at run time as repository rules for the fit and hygiene lenses to judge against. Any prompt that quotes PR bodies or issue text is injection-guarded.

### Overrides

- **Contract override** — a private contract file replaces the built-in lens and finding rules while the untrusted-data fences, repository rules, diff and JSON output schema stay. The runner reads `--contract <path>`, else `HAWKEYE_CONTRACT_PATH`, else `~/.config/hawkeye/contract.md` when it exists.
- **Prompt overrides** — a per-user override in the dashboard (taste), plus an optional `.hawkeye/REVIEW.md` in the repo (repo norms), appended when present.

## Triggers

**On open.** A pull request `opened` by a signed-in user in an installation linked to them turns reviews on and queues the first review, unless the user turned automatic review off (`user_settings.auto_review`, default on, the first checkbox on `/settings`). Nothing is armed retroactively, and a pull request the user paused stays paused. Turning on from the dashboard reviews now.

**On push.** Every `pull_request.synchronize` and `ready_for_review` to the armed PR reviews again. `reopened` does not trigger (head unchanged).

**On close.** `closed` / `merged` auto-disarms.

**Drafts.** Draft PRs can be armed; reviews start when ready unless the user opts in to draft reviews (the second checkbox on `/settings`). A draft opened by a linked user is left alone until `ready_for_review`, which turns it on then — unless the user reviews drafts, in which case it turns on at open. The opening date is not checked, by choice: a draft that was already open when this shipped also turns on when it becomes ready, the one case where an older pull request is armed.

**Quiet window.** The wait after a push (`quiet_window_s`, 0 to 600 seconds, default 0) is the third control on `/settings`. `armed_pr.quiet_window_s` can override it per pull request, but nothing sets that column yet.

**Runner offline.** Jobs queue, collapsed per PR to the latest head; no expiry. Dashboard: "runner offline, N PRs waiting".

---

# Architecture

## Data model

| Table | Holds |
|---|---|
| `User` | GitHub identity |
| `Runner` | token, last_seen; one per machine, revocable |
| `Installation` | App install, account |
| `ArmedPR` | repo, number, armed_by, quiet-window override |
| `Job` | armed_pr, head_sha, base_sha, head_current_at, not_before, state queued/claimed/done/failed |
| `Run` | job, runner, started/ended, turns, status, error |
| `Finding` | armed_pr, stable_id, detail, severity, first_seen_sha, resolved_sha?, github_comment_id |
| `ReviewPosted` | run, armed_pr, head_sha, github_review_id? — null while a round's review is in flight; the earliest filled row per pull request is the living review |
| `UserSettings` | prompt override, max-turns, wall clock, quiet window |

Everything is scoped by `user_id` from day one; no orgs, teams, or roles.

## The runner channel

The control plane runs two workloads with opposite shapes, and they must not share a runtime:

| | Dashboard, auth, webhooks | Runner connections |
|---|---|---|
| Request duration | 10–500 ms | minutes |
| Concurrency | bursty | flat, one per connected user |
| CPU while open | most of the duration | ~0% (waiting) |
| Right runtime | serverless | a long-lived process |

Serverless is close to ideal for the first column and close to worst-case for the second: a held connection bills for its whole life while doing nothing, and a per-connection poll loop makes database load a function of *user count × time* rather than of work.

**Today.** The claim endpoint long-polls inside a serverless function: up to 25 s per call with a queue check every 5 s. The long-poll is the shape this section replaces; everything below is the target. Its three cheap rules are met. The stale-claim sweep runs on a schedule, not in a request: `/api/internal/sweep`, guarded by `CRON_SECRET`, called every five minutes by a GitHub Actions workflow for the hosted instance (Vercel's Hobby cron fires once a day and stays as a backstop). The hot predicates are indexed: `job_claimable` (on `not_before` where `state = 'queued'`) serves the claim and `job_stale` (on `heartbeat_at` where `state = 'claimed'`) serves the sweep, both partial so finished jobs stay out of them. An idle runner backs off: one whose user has no pull request with reviews on is answered at once, with no hold and no queue check, and told to ask again in 60 seconds.

**Target shape.** Next.js stays on serverless for the dashboard, auth and webhook ingest. The runner channel moves to one always-on process that holds the idle connections in memory, with **a single `LISTEN` connection for the whole fleet** and in-memory fanout by user. The webhook that enqueues a job issues `NOTIFY`; the waiting runner is woken. Database work becomes proportional to pushes rather than to connected runners.

**Rules that follow from this:**

- **No per-request housekeeping.** Sweeps and other fleet-wide maintenance run on a schedule, never inside a request a client makes. One runner must never do the whole fleet's work.
- **Every hot-path predicate is indexed**, with partial indexes where the predicate is already selective on `state`.
- **Idle runners back off.** A user with no open pull requests does not need the same cadence as one mid-push.
- **Postgres stays the queue.** `FOR UPDATE SKIP LOCKED` is the right pattern and holds well past any volume this project will see; the job table carries durable state joined to arms, runs and findings, with invariants (one open job per arm, supersede semantics, the per-pull-request posting lock) that a second store would force us to hand-roll. No Redis, no broker.
- **The channel is one-directional.** The server says a job is ready; the runner claims it with an ordinary POST. That is SSE, not WebSocket, and it keeps the no-inbound-ports property the runner depends on.

## Principles

- **Credentials stay home.** The runner shells out to the user's own `claude` / `codex` CLI (`claude setup-token` for headless use). The control plane never sees a subscription credential and never proxies model traffic. This is not only good hygiene: the Claude Code terms require each end user to authenticate with their own credential, and forbid a third party from collecting or intermediating one.
- **Arm, don't roam.** Nothing is reviewed until its owner arms it.
- **`COMMENT` only.** Hawkeye has opinions, not authority.
- **One review per head SHA**, findings deduped by stable id, interdiff on re-review, addressed findings resolved — a push never re-spams old findings.
- **Budget is the user's plan.** Turns and wall clock per run are visible in the dashboard.
- **Harness-agnostic.** Claude Code at launch; Codex second; one harness interface so a new CLI is a new file.
- **Plumbing never leaks onto the PR.** Failures are dashboard-only.
- **Every review says what produced it.** The footer is load-bearing, not decoration.

---

# Running it

## Repo layout

TypeScript, pnpm monorepo: `packages/core` (contract, harness interface, render, dedupe, posting), `packages/runner` (CLI + daemon), `apps/web` (Next.js control plane).

## The runner CLI

1. Register a GitHub App (permissions: pull requests read/write, commit statuses read/write, contents read, issues read, metadata read; no webhook), generate a private key, install it on your repos.
2. Write `~/.config/hawkeye/config.json`:
   ```json
   { "appId": 123, "appSlug": "<app-slug>", "privateKeyPath": "~/.config/hawkeye/app.pem" }
   ```
   `~` is expanded. Env overrides: `HAWKEYE_APP_ID`, `HAWKEYE_APP_SLUG`, `HAWKEYE_APP_PRIVATE_KEY_PATH`.
3. `pnpm install && pnpm build`, then:
   ```sh
   npx hawkeye-review review <pr-url> [--dry-run [--full]] [--force] [--contract <path>] [--model <name>]
   ```
4. Optional: put your own review contract at `~/.config/hawkeye/contract.md`.

After posting it prints one line with the verdict, finding count, must-fix count when any, turns and duration, then the review's URL; on a terminal a "Reviewing owner/repo#N · turns · elapsed" line is rewritten in place while it runs. `--dry-run` prints the verdict and one line per finding instead of posting; `--full` prints the review as it would be posted.

Reviews post as `<app-slug>[bot]` (the author's instance: `hawkeye-review[bot]`). Run artifacts land in `~/.cache/hawkeye/runs/`.

## Reviewing locally in any agent session

Four commands — `prepare`, `show`, `dismiss`, `undismiss` — let any agent session (any model) review a pull request with the Hawkeye contract, without the control plane, a harness, or posting.

```sh
npx hawkeye-review prepare <pr-url> [--github-token <token>] [--contract <path>] [--root <dir>]
# … the session reads prompt.md, reviews checkout/, writes result.json …
npx hawkeye-review show <round-dir> [--full]
```

`prepare` fetches the pull request, checks its head out, writes the review prompt into a round directory, and prints the round with its prompt, checkout and result paths and the `show` command to run next. `show` validates the result file, derives the verdict, and prints the verdict, its reason and one line per finding with its path and id, then where the full result lives; `--full` prints the whole review with details, prior findings, lenses and rounds. Exit code is 0 whenever the result parses — the verdict is information, not a failure.

### Credentials and layout

The token is `--github-token`, else `GITHUB_TOKEN`, else `gh auth token`; without one `prepare` stops with a message. It is only used to read the pull request, its linked issue and the merge base, and to clone; nothing is ever posted. It reaches git through an environment variable (`--config-env`) as an `Authorization` header, so it is never written into the checkout's configuration and never appears on a command line (git 2.31 or newer).

Rounds live under `~/.cache/hawkeye/reviews/<owner>/<repo>/<number>/round-<N>/` (`--root` moves them):

| Path | Holds |
|---|---|
| `prompt.md` | The review prompt |
| `checkout/` | The PR head, with its `CLAUDE.md`, `CLAUDE.local.md` and `.claude/` removed |
| `meta.json` | Round number, head, base and merge base shas, start time, PR coordinates |
| `result.json` | Written by the session |

Rounds accumulate per pull request (N = 1 + the highest existing round) so an earlier round's findings stay readable; only the `checkout/` of older rounds is removed, after the new one is in place.

### Rounds

A second `prepare` on the same pull request reviews against the previous round: the highest earlier round with a parsed `result.json` (a round without a result is passed over; one with a broken result is skipped with a warning on stderr). The checkout also fetches that round's head and the prompt gains a `# Previous round` section: the earlier findings with their stable ids and details, the interdiff, and the rules for the round. `meta.json` records `previousRound`, `previousHeadSha` and `carriedFindings`.

**Round rules.** Report every prior finding in `priorFindings` as `addressed`, `open` or `withdrawn` with a note; repeat still-open findings in `findings` with the same path and claim so the id stays stable; raise new findings only about what the interdiff changed or newly exposed (or, without an interdiff, about anything the previous round missed). A finding whose last reported status is open is carried into the next prompt even if the round that reported it forgot to repeat it.

### Interdiff

`git diff <previous head>..HEAD`, limited to files the pull request touches — the merge-base diff of the head, plus files that existed at the previous head and changed since, which covers a revert or a deletion. A file that only arrived from the base branch is left out. One edge is invisible: a file deleted in an earlier round and later restored byte-identical to its base version cannot be told apart from a base-branch arrival, so it stays out of the interdiff.

An unchanged head is stated instead of an empty diff; a head that moved without changing anything reviewable in the pull request's files is stated as such; when the previous head was force-pushed away the prompt says so and the round reviews the full diff with the prior findings as context.

### Dismissals

```sh
npx hawkeye-review dismiss <round-dir> <finding-id> <reason>
npx hawkeye-review undismiss <round-dir> <finding-id>
```

`dismiss` records the reason in the `dismissed.json` of the round that raised the finding, searching back from the given round (which may still be pending, so an id copied from a `Prior findings:` list works). Every later round's prompt carries the reason and asks for the finding to be reported as `withdrawn` unless the new changes prove the reason wrong.

### What `show` warns about

`show` prints a `Prior findings:` list (id, status, the claim when the previous round is readable, note) when the result has one, and ends with a `Rounds:` table over every round of the pull request. It marks in the text, and warns on stderr, when:

- a prior finding reported open is not repeated in the findings (the verdict only counts the findings list)
- a later round reports no prior findings at all
- some of the findings the prompt carried are left unreported

It checks against the ids recorded in `meta.json` when the round was prepared.

## The runner daemon

On the machine that holds your Claude Code login:

```sh
npx hawkeye-review runner login --url <control plane url>   # once
npx hawkeye-review runner
```

`login` prints the code, the `/connect` link and that it is waiting; you approve the code in the browser, and it confirms the connection and that the runner token is stored in `~/.config/hawkeye/runner.json`. A `--token` from `/runners` skips the browser; `--name` overrides the hostname. Env overrides: `HAWKEYE_CONTROL_PLANE_URL`, `HAWKEYE_RUNNER_TOKEN`.

The daemon then loops: claim a job, clone the PR with the one-hour token the job carries, run Claude Code with the review contract, heartbeat, report the result.

**Reviews at once.** The daemon remembers the concurrency the last claimed job carried and keeps that many reviews running, with one claim call open at a time, claiming again whenever a slot frees. The first job after a start runs alone, a change in Settings reaches the daemon with its next job, stopping waits for every running review, and `--once` runs one job regardless. With more than one slot every line of a job carries its slot number in brackets before the subject, and each job's detail lines go to its own run directory.

**Output.** One line per state change on stderr, time first, then a state word (`polling`, `contract`, `claimed`, `reviewing`, `posted`, `skipped`, `failed`, `waiting`, `delivered`, `idle`, `stopping`) and the subject. The posted line carries the verdict, counts, turns and duration; the run's detail lines (one per turn) go to `log.txt` in the run directory.

**Retries.** `--once` handles a single job and exits non-zero when three claims in a row fail or the result cannot be delivered. The daemon waits a second after an empty poll, or as long as the answer's `Retry-After` says (1 to 300 seconds; it logs `idle` once when that starts), retries a failed claim after five seconds, and retries a failed result report three times (2 s, 4 s, 8 s) before logging it and moving on. The control plane requeues a claim that stops heartbeating.

**Flags.** `--contract <path>` overrides the built-in contract (else the job's per-user override, else the default); `--model <name>` picks the claude CLI model for every job this runner claims.

The daemon never posts to GitHub; the control plane does. It needs Node 22+, git 2.31 or newer and the `claude` CLI signed in; it holds no GitHub credentials of its own.

## The control plane

### Running it locally

```sh
docker compose up -d --wait db
cp apps/web/.env.example apps/web/.env
pnpm --filter web db:migrate
pnpm --filter web dev
```

The app resolves `@hawkeye/core` through the workspace link to its built `dist`, so `pnpm --filter @hawkeye/core build` (or `pnpm build`) has to run before `next dev` or `next build`. `pnpm --filter web typecheck` checks against core's sources and needs no build.

### GitHub App configuration

**Sign-in** uses the GitHub App's OAuth client. In the App settings set the callback URL to `<BETTER_AUTH_URL>/api/auth/callback/github`, generate a client secret, and grant the account permission *Email addresses: read* (Better Auth needs an email; GitHub hides private ones otherwise).

**Webhook.** Enable it with URL `<BETTER_AUTH_URL>/api/github/webhook` and a secret (`GITHUB_WEBHOOK_SECRET`), subscribed to Installation and Pull request events. Delivery needs a public URL, so locally you can only replay signed payloads or forward deliveries through a tunnel.

**Permissions.** Minting installation tokens to list an installation's repositories and pull requests needs Contents: read and Pull requests: read; posting reviews needs Pull requests: read and write.

**Env** (see `apps/web/.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`. The last holds the PEM contents of the App's private key, with newlines written either literally or as `\n`.

### Installation sync

At every sign-in, and each time the pull request listing is fetched (held a minute per user, so a repository the App is installed on later appears within a minute with no control to press), the control plane asks GitHub which installations of the App the signed-in account can access (`GET /user/installations` with the user's token, refreshed by Better Auth when expired). It upserts the ones that are not suspended into `installation`, links them in `installation_user`, unlinks the ones the account can no longer reach, and — after a sign-in that changed anything — forgets the user's held pull request listing. The installation webhook still links the installer at once.

### Webhook deliveries

A push to an armed PR (`synchronize` and `ready_for_review`) queues a job for the new head after the quiet window (armed override, else the user setting, else 0 s), replacing any job still waiting. The handler first checks that the delivery's head is still the pull request's current head, which drops a delivery that arrives late; two deliveries handled at the same time both pass that check, so each job also carries the moment GitHub says its head was current (`pull_request.updated_at` from the delivery, or from the fetched pull request when the dashboard queues a review), and a waiting job is only replaced by a newer moment. The moment has one-second resolution, so two pushes within the same second still leave whichever delivery lands last. A job already claimed keeps running until its next heartbeat, whose response says it is superseded; the daemon then stops the review, reports it as `superseded`, and claims the newer job. A daemon with a free slot may claim the newer job first; it then stops the older review of that pull request at once rather than waiting for the heartbeat, and when the older result arrives the control plane leaves the living review's reviewing block alone, because the newer run owns it by then; the older run's own placeholder comment, when it has one, is still closed with the superseded sentence. Drafts are skipped unless the user opted into reviewing drafts. Closing or merging the PR disarms it for everyone and cancels any job still waiting. `reopened` does not trigger.

### Connecting a runner

`/runners` manages runner tokens: create one (the `hk_…` token is shown once, only its hash is stored), see when each runner was last seen, revoke one.

`/connect` is the other way. Under its title it says what connecting grants (a coding agent runs on that machine, as the user, over code they did not write; editing and web tools removed, the shell kept) and links the README's "What the runner can reach". It shows the login command, a form to type and approve the code that command prints (the link the CLI prints carries the code so the page can describe the pending login, but the code is typed, never prefilled), and whether a runner is online (a non-revoked runner seen within 90 s) or offline with the number of queued jobs waiting.

Behind it is a device-code flow with two unauthenticated endpoints:

| Endpoint | Behaviour |
|---|---|
| `POST /api/runner/login` `{ name }` | 201 `{ code, deviceSecret, verifyUrl, expiresAt, intervalSeconds }`. The code is `XXXX-XXXX`; the login expires after 10 minutes |
| `POST /api/runner/login/collect` `{ deviceSecret }` | 200 `{ status: "pending" }` until approved on `/connect`, then 200 `{ status: "approved", token }` exactly once, then 410 `{ status: "expired" }` — as for an unknown secret or a lapsed login |

The runner and its token are created at the moment of approval, so no token is ever stored. Expired logins are deleted whenever a login starts, a lapsed one is collected, or `/connect` loads; a collected login is deleted on the spot; when 1000 logins are open the oldest is evicted to make room. A per-client rate limit at the edge is the hosted deployment's job. The device secret is the only credential, so the endpoints are not rate limited yet; a login only ever yields a token for the signed-in user who typed the code.

### The job API

With a runner token:

| Endpoint | Behaviour |
|---|---|
| `GET /api/runner/jobs` | When the user has no pull request with reviews on and the daemon sent `X-Hawkeye-Honors-Retry-After: 1` (0.7.0 and later), answers 204 at once with `Retry-After: 60`; a daemon that does not send it is held as before, since it would ask again a second later. Otherwise long-polls for up to 25 s, checking the queue every 5 s. Returns the claimed job with a fresh installation token, the pull request coordinates, the user's review settings and — from the second round of an arm on — the previous round (the last posted round's findings with stable ids, plus the arm's still-open findings), or 204 when nothing is queued |
| `POST /api/runner/jobs/<id>/heartbeat` | Keeps the claim alive (a claim without a heartbeat for 5 minutes goes back to the queue) and answers `{ ok, superseded }`, true once a newer job exists for the same arm |
| `POST /api/runner/runs/<id>/events` | Accepts `{ type, at, data }` entries and counts the `turn` ones |
| `POST /api/runner/runs/<id>/result` | Posts `{ status, turns, result?, error?, commentable? }`, storing the review result and closing the run and the job |

With `CRON_SECRET` as a bearer token, `GET` or `POST /api/internal/sweep` requeues the jobs whose runner went silent for five minutes (failing one that a newer job for the same pull request has overtaken) and answers `{ ok, swept }`; without the secret it answers 401. A job it fails will never send a result, so the sweep closes it on the pull request the way a failed result would: the commit status becomes success "Review did not complete" and the reviewing line is replaced by the sentence that says so (left alone when a newer run owns the living review's block). A requeued job is left as it is, since the next claim marks both again. These writes are best effort: a GitHub failure is logged and the sweep still completes.

### Posting a review

For an `ok` result the control plane renders the review — inline comments on the lines the runner reported as `commentable`, the rest in the body — and posts it on the pull request.

**One review per pull request, updated in place.** The first round posts it; every later round edits its body to carry the new round's verdict, summary and findings plus the prior findings' statuses and a rounds table, posting new inline comments only for findings new to that round.

**One round per head**, reserved in `review_posted` under a per-pull-request lock: the first round posts under that lock, later rounds post outside it and are recorded right after each GitHub write. So a second run for the same head posts nothing, and a round that finds a newer head under review yields to it.

**GitHub is asked before a first post.** If the database fails just after a review was written, the record of it rolls back, and the database alone would post a second review on the next run. So when it knows of no review for a pull request, the control plane lists the pull request's reviews and looks for one by its own bot (`GET /app` gives the login, asked once per process) that carries a head marker and a verdict; the inline-comment reviews carry the marker alone and are skipped. One for the same head is adopted as that head's record and nothing is written. One for an older head is adopted as the living review and edited like any later round; either way the run's own placeholder is closed with the already-posted sentence, and an adopted review is never overwritten with a closing sentence when a round fails. The record points at the adopting run's result, so the next round dedupes against that result rather than the body another run rendered. GitHub is asked outside the per-pull-request lock, and only when the database knows no living review, no round for the head and no newer head. If GitHub cannot be asked, nothing is posted and the run fails with GitHub's message.

Each finding is also stored in `finding` under its stable id with the head it was first seen on and the head it disappeared on — unless a newer job for the pull request has already completed, in which case the older result is reported as `superseded` and leaves the rows alone. A repeat run of the same arm for a head it already posted is reported as `already-posted` and leaves them alone too. A recording error is logged and reported as `failed` without affecting the posted review; a failed post keeps the result and records the error on the run.

The response says `posted`, `already-posted`, `superseded` or `failed`.

### The dashboard

**`/`** is the landing page for a signed-out visitor: the headline, a fixed stage that replays a real first-round review of Hawkeye's own pull request 87 from open to posted (a fixture rendered by the shipped renderer, in `apps/web/src/landing-review.ts`), what happens on a pull request, what it costs, and how to start. A signed-in visit redirects to `/overview`.

**`/overview`** shows whether a runner is online, five all-time figures with this month beneath (reviews, pull requests reviewed, findings raised and addressed, must-fix caught, cost in hours and turns), a grid of review days over the last 52 weeks, and the five most recent reviews with their titles, linking to their pages. It paints its figures from the database first and streams the recent reviews in behind a skeleton while titles arrive.

**`/prs`** lists the open pull requests you authored across your installations, one row each: the title with repo and number, one status word about the review (Queued, Waiting with the runner offline, In review, Run failed, or the last verdict; none while reviews are on and nothing has run yet), the round count, open findings, when the last review ended, and the review control at the end — a circle with Review or Reviewing beside it. Clicking Review queues a review for the current head and marks the PR for review on every later push; hovering Reviewing reads Pause. The row answers the click at once and rolls back with a sentence if the server refuses.

**Per-pull-request pages** list the PR's runs with status, verdict (and the model's own verdict when it disagreed), turns, duration and the posted review link, and its findings with their stable ids, the head each was first seen on and whether it was resolved.

**Freshness.** Every dashboard page refetches every 30 s while visible and when the tab regains focus; the top bar says in small text how long ago it was updated, and the progress line shows under it while a fetch runs. The part of the list that comes from GitHub (which pull requests are open, their titles) is held for a minute per user — 15 s when an installation refused — so it can be up to a minute behind while review states are 30 s fresh. Titles shown on Overview and the detail page are held for ten minutes.

The header shows how many pull requests have reviews on and are in review and whether a runner is online, with an offline sentence linking to `/connect` when jobs are waiting.

**`/admin/funnel`** exists only for the GitHub logins listed in `ADMIN_LOGINS` (comma separated, empty by default, so a deployment that sets nothing has no such page and it answers 404). It counts, from rows the control plane already stores, how many accounts signed in, installed the App, connected a runner, had a runner come online (`runner.first_seen_at`, stamped on a runner's first authenticated request) and got a first posted review, all time and by the week the account signed in (weeks start on Monday, in UTC), with each step's share of the step before. The steps nest: an account counts at a step only if it also reached every step before it, so a share never passes 100%. Nothing is sent to any analytics service; there is none.

### Hosting

A Vercel project with a Neon Postgres and the same env, configured with Root Directory `apps/web`, Install Command `pnpm install` (pnpm installs the whole workspace from any package in it) and Build Command `pnpm --filter @hawkeye/core build && pnpm build` — both run from `apps/web`; the filter finds the workspace root on its own. Run `pnpm --filter web db:migrate` against Neon before the first deploy.

---

# Status

## Milestones

1. **Runner alone, manual.** `hawkeye review <pr-url>` from a laptop: worktree → `claude -p` → findings → posted via the same `core` posting module, using a locally held App key. Proves contract and identity. Dogfood. **(shipped)**
2. **Control plane + arm.** Next.js app with GitHub sign-in, App webhooks, PR list, Arm, jobs; runner becomes a daemon that long-polls with a runner token; reviews on every push with quiet window and interdiff; control plane posts. **(in progress)**
3. **Multi-user + OSS release.** Official hosted instance, Codex harness, self-host docs (`docker compose`, App Manifest flow at `/setup`), public repo under MIT.
4. **Always-on + polish.** Runner Docker image for a VPS, run history and budget view, re-review-now, reviewing pull requests you do not own.

## Decisions

- **Open source** (MIT); official hosted instance run by the author; self-hostable end to end.
- **Split brain:** hosted control plane + user-owned runner; the model never runs hosted.
- **Control plane posts;** runner returns JSON only.
- **Identity:** the App where it is installed (`hawkeye[bot]` hosted, currently `hawkeye-review[bot]`; `hawkeye-<handle>[bot]` self-hosted), else the requesting user. No machine user.
- **Contributions:** a review the App posts does not touch the user's contribution graph; a review posted as the user appears in their review activity like any other. Accepted, because the footer carries the distinction.
- **Trigger:** automatic from open for the author's own pull requests (per-user switch, default on), or from the dashboard; then every push. Quiet window default 0.
- **Hosting:** Next.js + Postgres, deployable to Vercel + Neon and as a single Docker Compose. No Workers/D1 (locks self-hosters to one vendor).
- **Runner channel:** today the runner long-polls with a runner token and posts results back; clone with a 1h App installation token shipped in the job. The target is a ready signal from a long-lived process rather than a poll held by a serverless function — see [The runner channel](#the-runner-channel).
- **The job carries the user's settings:** turn and wall-clock limits, the prompt override, the model (one of a fixed list of pinned versions the web keeps and the claude CLI accepts, else the CLI default; a daemon started with `--model` keeps its own; a new model is added to the list and shipped; when the CLI refuses the chosen model, the runner reviews once more on the CLI default in the same run, and the run row and the review footer say which model was refused; a runner older than the release that ships this fails the run as before and reports no refused model) the harness name (`claude-code` until a second harness exists) and the concurrency (1 to 3, default 1).
- **Review contract:** all six lenses by default; overrides per user and per repo.
- **Subscription terms:** the user is responsible for staying within their plan's terms; Hawkeye only drives the CLI they already run. Stated in the README and on the runner-setup page.

## Open questions

1. **Name collision.** "Hawkeye" is a common product name (and a Marvel character); fine for OSS. Register the `hawkeye` GitHub App slug and the `hawkeye-review` handle now.
2. **The harness trust boundary.** The review runs `bypassPermissions` with Bash over a checkout of code the user did not write, with their own environment and filesystem in reach. Reviewing pull requests you do not own widens that from code you trust to code anyone can send you, so the boundary has to be closed before that ships.
3. **Posting as the user.** Sign-in uses the App's OAuth client, and a GitHub App user token reaches only repositories the App is installed on, so it cannot post on the repositories this identity exists for. The second identity needs another credential (an OAuth App grant, or a fine-grained token the user supplies), a trigger that is not a webhook (polling the user's open pull requests, or review-now from the dashboard), and a clone path that uses it. Undecided; nothing is built on the second row until it is.

## Name

**Hawkeye** — the sharp-eyed reviewer; reads naturally as `hawkeye[bot]`.

Availability check (2026-08-22): npm `hawkeye`, `hawkeye-bot`, `hawkeye-review` unclaimed; GitHub App slugs `hawkeye`, `hawkeye-bot`, `hawkeye-review`, `hawkeye-code-review`, `hawkeye-pr` show no public app (App names are globally unique including private apps, so confirm at creation time; `hawkeye-reviewer` and `hawkeye-app` are taken). GitHub usernames `hawkeye`, `hawkeye-bot`, `hawkeyebot`, `hawkeye-app`, `hawkeye-dev` are taken; `hawkeye-review`, `hawkeyereview`, `usehawkeye`, `hawkeyehq` are free. Domains: `hawkeye.dev/.app/.sh/.bot` resolve (taken); `hawkeye.review`, `hawkeyereview.com`, `hawkeyebot.com`, `gethawkeye.dev` have no DNS and are worth checking at a registrar.

Earlier candidates, kept for the record: Relook (the working name before this), Marginalia, Redpen, Squire, Rubric, Lookover, Pullwatch.
