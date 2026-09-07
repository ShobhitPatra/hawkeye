import type { GitHubClient, PullRequestReference } from "@hawkeye/core";
import { hold, type HoldStore } from "./hold";

export type TitledReference = PullRequestReference & { installationId: string };

export const TITLE_TTL_MS = 10 * 60_000;
const held: HoldStore<string> = new Map();

export async function pullRequestTitles(
  github: GitHubClient,
  references: TitledReference[],
  memory: { cache?: HoldStore<string>; now?: number } = {},
): Promise<Map<string, string>> {
  const cache = memory.cache ?? held;
  const now = memory.now ?? Date.now();
  const titles = new Map<string, string>();
  const missing = new Map<string, TitledReference>();
  for (const reference of references) {
    const key = titleKey(reference);
    if (titles.has(key) || missing.has(key)) continue;
    const fresh = cache.get(key);
    if (fresh && now - fresh.at < fresh.ttl) titles.set(key, await fresh.value);
    else missing.set(key, reference);
  }
  const fetched = await fetchTitles(github, [...missing.values()]);
  for (const [key, title] of fetched) {
    titles.set(key, title);
    hold(cache, key, { now, ttlMs: TITLE_TTL_MS }, async () => title);
  }
  return titles;
}

async function fetchTitles(
  github: GitHubClient,
  references: TitledReference[],
): Promise<Map<string, string>> {
  const byInstallation = new Map<string, TitledReference[]>();
  const seen = new Set<string>();
  for (const reference of references) {
    if (seen.has(titleKey(reference))) continue;
    seen.add(titleKey(reference));
    const group = byInstallation.get(reference.installationId) ?? [];
    group.push(reference);
    byInstallation.set(reference.installationId, group);
  }
  const titles = new Map<string, string>();
  await Promise.all(
    [...byInstallation].map(async ([installationId, group]) => {
      let token: string;
      try {
        token = await github.installationTokenById(installationId);
      } catch {
        return;
      }
      await Promise.all(
        group.map(async (reference) => {
          try {
            const details = await github.pullRequest(reference, token);
            titles.set(titleKey(reference), details.title);
          } catch {
            return;
          }
        }),
      );
    }),
  );
  return titles;
}

export function titleKey(reference: PullRequestReference): string {
  return `${reference.owner}/${reference.repo}#${reference.number}`;
}
