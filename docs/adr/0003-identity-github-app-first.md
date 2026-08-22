---
status: accepted
---
# Identity: GitHub App first; hosted = `hawkeye[bot]`, self-host = `hawkeye-<handle>[bot]`

A review must come from a bot identity, never the user's own account, and GitHub only lets an account comment where it has access. We decided: reviews post via a GitHub App. The hosted instance registers the single App `hawkeye`, so every hosted user posts as `hawkeye[bot]`. Self-hosters register their own App (GitHub App names are globally unique) through the App Manifest flow from their instance's `/setup` page, by convention `hawkeye-<handle>`. A per-repo or per-user identity on the hosted instance was rejected: Apps are registered once and installed per repo, and the `hawkeye-` prefix cannot be owned. Other people's **private** repos are out of scope (no reviewer can act there without the admin installing it). A machine-user identity for the user's PRs to public OSS repos is planned later; resolution order is App installation → machine user on a public repo → skip. Every review carries a footer crediting Hawkeye.

## Consequences

- Nothing Hawkeye posts counts toward the user's contribution graph. Accepted.
- Hosted users get the one well-known badge; self-hosters get a recognisable prefix plus the footer.
- The App requests: pull requests read/write, contents read, metadata read, issues read.
