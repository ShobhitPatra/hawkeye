import type { GitHubClient, PullRequestReference } from "@hawkeye/core";
import { hold, type HoldStore } from "./hold";

export type TitledReference = PullRequestReference & { installationId: string };

export const TITLE_TTL_MS = 10 * 60_000;
export const MISSING_TITLE_TTL_MS = 15_000;
const held: HoldStore<string | undefined> = new Map();

export async function pullRequestTitles(
  github: GitHubClient,
  references: TitledReference[],
  memory: { cache?: HoldStore<string | undefined>; now?: number } = {},
): Promise<Map<string, string>> {
  const cache = memory.cache ?? held;
  const now = memory.now ?? Date.now();
  const wanted = new Map<string, TitledReference>();
  for (const reference of references) wanted.set(titleKey(reference), reference);
  const missing = [...wanted].filter(([key]) => {
    const fresh = cache.get(key);
    return !(fresh && now - fresh.at < fresh.ttl);
  });
  let batch: Promise<Map<string, string>> | undefined;
  const fetchMissing = () =>
    (batch ??= fetchTitles(
      github,
      missing.map(([, reference]) => reference),
    ));
  const titles = new Map<string, string>();
  await Promise.all(
    [...wanted.keys()].map(async (key) => {
      const title = await hold(
        cache,
        key,
        {
          now,
          ttlMs: TITLE_TTL_MS,
          ttlAfter: (value) => (value === undefined ? MISSING_TITLE_TTL_MS : TITLE_TTL_MS),
        },
        () => fetchMissing().then((fetched) => fetched.get(key)),
      );
      if (title !== undefined) titles.set(key, title);
    }),
  );
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
