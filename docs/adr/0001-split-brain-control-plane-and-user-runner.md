---
status: accepted
---
# Split brain: hosted control plane + user-owned runner

Hawkeye needs something always listening (webhooks, arm state, job queue, dashboard) and something that runs `claude -p` / `codex exec` under the user's own subscription login on a real filesystem. We decided to split these: a hosted **control plane** (Next.js + Postgres) that never executes a model, and a per-user **runner** on hardware the user owns that pulls jobs over long-poll with a runner token. The alternatives were a purely local tool (no automatic "review on every push", no dashboard) or a fully hosted service (would require holding users' plan credentials or API keys — the thing the product exists to avoid). The runner must work against a self-hosted control plane; the hosted instance is a convenience, not a dependency.

## Consequences

- Plan credentials never leave the user's machine; the control plane stores only GitHub App installation data and review state.
- Reviews queue while a runner is offline; per PR, queued jobs collapse to the latest head SHA.
- Serverless cannot host the runner; Docker image for laptop and VPS.
