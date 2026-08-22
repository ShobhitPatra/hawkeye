---
status: accepted
---
# The control plane posts reviews; the runner only returns findings

The runner could post the GitHub review itself (it has the checkout and the result), but that would put the GitHub App private key and the render/dedupe/resolve logic on every user machine. We decided the runner's output is validated findings JSON only; the control plane renders the review, dedupes against stored findings, posts as the bot identity, replies "addressed" on resolved findings, and stores posted ids. Milestone 1 (CLI-only, no control plane) uses the same `core` posting module locally so nothing is rewritten when the control plane arrives.

## Consequences

- App credentials and posting logic live in exactly one place.
- The runner is dumb: clone → harness → JSON → report. Easy to reimplement, easy to audit.
- A run whose result cannot be posted (e.g. installation removed) fails in the dashboard, never on the PR.
