type InRepository = { owner: string; repo: string };

export function repositoryName(pullRequest: InRepository) {
  return `${pullRequest.owner}/${pullRequest.repo}`;
}

export function listRepositories(pullRequests: (InRepository & { updatedAt: string })[]) {
  const latest = new Map<string, string>();
  for (const pullRequest of pullRequests) {
    const name = repositoryName(pullRequest);
    const seen = latest.get(name);
    if (seen === undefined || pullRequest.updatedAt > seen) latest.set(name, pullRequest.updatedAt);
  }
  return [...latest].toSorted(([, a], [, b]) => b.localeCompare(a)).map(([name]) => name);
}

export function findRepository(repositories: string[], requested: string) {
  const wanted = requested.toLowerCase();
  return repositories.find((name) => name.toLowerCase() === wanted);
}

export function narrowToRepository<PullRequest extends InRepository, Status>(
  listing: { pullRequests: PullRequest[]; statuses: Map<string, Status> },
  requested: string,
) {
  const wanted = requested.toLowerCase();
  return {
    pullRequests: listing.pullRequests.filter(
      (pullRequest) => repositoryName(pullRequest).toLowerCase() === wanted,
    ),
    statuses: new Map(
      [...listing.statuses].filter(([key]) => key.toLowerCase().startsWith(`${wanted}#`)),
    ),
  };
}
