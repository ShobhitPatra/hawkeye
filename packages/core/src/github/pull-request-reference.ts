export type PullRequestReference = { owner: string; repo: string; number: number };

const URL_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const SHORT_PATTERN = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#(\d+)$/;

export function parsePullRequestReference(input: string): PullRequestReference {
  const match = URL_PATTERN.exec(input.trim()) ?? SHORT_PATTERN.exec(input.trim());
  if (!match)
    throw new Error(
      `Not a pull request reference: "${input}" (expected https://github.com/owner/repo/pull/N or owner/repo#N)`,
    );
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}
