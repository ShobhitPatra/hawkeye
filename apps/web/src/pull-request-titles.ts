import type { GitHubClient, PullRequestReference } from "@hawkeye/core";

export type TitledReference = PullRequestReference & { installationId: string };

export async function pullRequestTitles(
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
