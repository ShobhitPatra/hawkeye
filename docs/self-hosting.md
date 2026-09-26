# Self-hosting Hawkeye

Hawkeye is two parts. The control plane is a Next.js app on Postgres: sign-in, the GitHub App webhook, the queue, the dashboard, and the posting of reviews. The runner is `npx hawkeye-review runner` on a machine with a Claude Code login; it never holds GitHub credentials of its own. This guide sets up the control plane; the runner is the same two commands whichever way you host it.

Most people should use the hosted instance at [hawkeye-review.vercel.app](https://hawkeye-review.vercel.app); this guide is for running your own. The shape is Vercel for the app and Neon for Postgres, which is how the hosted instance runs. A local machine with Docker Compose works for development.

## 1. Create a GitHub App

Every self-hosted instance posts as its own App, so reviews carry your name: `<your-app-slug>[bot]`.

1. GitHub, Settings, Developer settings, GitHub Apps, New GitHub App. Name it (the name becomes the bot's handle).
2. Homepage URL: the URL your control plane will have (a Vercel deployment gets `https://<project>.vercel.app`).
3. Callback URL: `https://<your control plane>/api/auth/callback/github`. Leave "Expire user authorization tokens" on; turn "Request user authorization (OAuth) during installation" off.
4. Webhook: active, URL `https://<your control plane>/api/github/webhook`, and a secret you generate (keep it for `GITHUB_WEBHOOK_SECRET`).
5. Repository permissions: Contents read, Issues read, Metadata read, Pull requests read and write, Commit statuses read and write. Account permissions: Email addresses read (sign-in needs an email and GitHub hides private ones otherwise).
6. Subscribe to events: Installation, Pull request.
7. Where can this App be installed: any account.
8. Create it, then on the App page generate a client secret (for `GITHUB_CLIENT_SECRET`), note the App ID and Client ID, and generate a private key (a `.pem` file, for `GITHUB_APP_PRIVATE_KEY`).

The callback and webhook URLs can be filled in after the deployment exists; nothing else depends on them.

## 2. Create the database on Neon

1. Create a project at [neon.com](https://neon.com); the free plan is enough to start. Postgres 17 or newer.
2. Copy the pooled connection string (the one ending in `-pooler...neon.tech/neondb?sslmode=require`). That is `DATABASE_URL`.

The control plane keeps a job queue that runners long-poll, so its compute stays awake while a runner is connected. On Neon's free plan that is 100 compute hours a month; one runner running around the clock uses about 180, so plan on the Launch plan, or on the [Neon open source program](https://neon.com/programs/open-source) if your instance serves an open source project.

## 3. Deploy to Vercel

Import the repository into a Vercel project with Root Directory `apps/web`, Install Command `pnpm install`, Build Command `pnpm --filter @hawkeye/core build && pnpm build`. The environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon pooled connection string |
| `BETTER_AUTH_SECRET` | 32 random bytes as hex (`openssl rand -hex 32`) |
| `BETTER_AUTH_URL` | the deployment's public URL, no trailing slash |
| `GITHUB_CLIENT_ID` | from the App page |
| `GITHUB_CLIENT_SECRET` | from the App page |
| `GITHUB_WEBHOOK_SECRET` | the webhook secret you generated |
| `GITHUB_APP_ID` | from the App page |
| `GITHUB_APP_PRIVATE_KEY` | the contents of the `.pem`, newlines kept or written as `\n` |
| `CRON_SECRET` | 32 random bytes as hex (`openssl rand -hex 32`); guards the sweep route below |
| `ADMIN_LOGINS` | optional; GitHub logins, comma separated, that may open `/admin/funnel`. Empty means the page does not exist. A login can be renamed and the old name claimed by someone else, so take a login off the list if you rename the account |

Before the first deployment finishes, run the migrations against Neon from your machine:

```sh
pnpm install
DATABASE_URL='<the Neon connection string>' pnpm --filter web db:migrate
```

Run the same command after pulling a version that adds a migration; migrations are additive and safe to run before the matching deployment goes live.

Then set the App's callback and webhook URLs to the deployment's URL, if you left them for later, and redeploy once so `BETTER_AUTH_URL` is baked in.

## Schedule the sweep

A runner that dies mid-review leaves its job claimed. When any runner of the same user next asks for work, the claim puts that job back and hands it over, five minutes after the last heartbeat; no clock is needed for that. The sweep covers the rest: a runner that never comes back leaves its pull request showing In review until something requeues it. `POST /api/internal/sweep` (GET works too) puts every job whose runner has been silent for five minutes back in the queue, and answers 401 to any caller that does not send `Authorization: Bearer <CRON_SECRET>`. Nothing calls it on its own, so give it a clock; every one to five minutes is plenty.

- **Vercel Cron.** `apps/web/vercel.json` schedules the route once a day, which is all the Hobby plan allows; Vercel sends the secret itself once `CRON_SECRET` is set. On Pro, change the schedule to `* * * * *` and nothing else is needed.
- **Anything else with a timer.** The repository's `.github/workflows/sweep.yml` calls the route every five minutes for the hosted instance; in a fork, set the repository secret `CRON_SECRET` and the variable `CONTROL_PLANE_URL` and drop the repository check at the top of the job. GitHub's schedule is best effort: runs are often late, sometimes skipped, and the schedule is switched off after 60 days without activity in the repository. If recovery time matters to you, use a clock you control. A cron line on any machine does the same:

  ```sh
  */5 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your control plane>/api/internal/sweep
  ```

## 4. Sign in and install the App

Open the deployment, sign in with GitHub, and install the App on the repositories you want reviewed. Today the dashboard lists installations made by the signed-in account; other members of an organization see them once [#48](https://github.com/ShobhitPatra/hawkeye/issues/48) lands.

## 5. Connect a runner

On the machine with your Claude Code login:

```sh
npx hawkeye-review runner login --url https://<your control plane>
npx hawkeye-review runner
```

Approve the code in the browser when the first command prints it. The second command is the daemon; leave it running. It needs Node 22, git 2.31 and the `claude` CLI signed in. Turn reviews on for a pull request from the dashboard, or push to one that already has reviews on.

## Local machine instead

For development, or to try Hawkeye without deploying:

```sh
docker compose up -d --wait db
cp apps/web/.env.example apps/web/.env      # fill in the GitHub App values; DATABASE_URL already points at Compose
pnpm install
pnpm --filter web db:migrate
pnpm --filter @hawkeye/core build
pnpm --filter web dev
```

GitHub has to reach the webhook, so `BETTER_AUTH_URL` and the App's URLs need a public tunnel to port 3000 (any tunnel works); without one, arming and sign-in work but no push ever queues a review.

## Updating

Pull `main`, run the migration command against your database, and redeploy. Vercel redeploys on push if the project is connected to your fork; the runner updates itself on the next `npx hawkeye-review` start, or pin a version with `npx hawkeye-review@<version>`.
