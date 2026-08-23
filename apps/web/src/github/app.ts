import { createAppJwt } from "@hawkeye/core";

export type InstallationRepository = {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
};

export type OpenPullRequest = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  updatedAt: string;
  htmlUrl: string;
};

type Dependencies = { fetch: typeof fetch };

const API = "https://api.github.com";
const PER_PAGE = 100;
const CONCURRENCY = 5;

const headers = (authorization: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: authorization,
  "X-GitHub-Api-Version": "2022-11-28",
});

async function request(
  deps: Dependencies,
  method: string,
  url: string,
  authorization: string,
): Promise<Response> {
  const response = await deps.fetch(url, { method, headers: headers(authorization) });
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${new URL(url).pathname} failed: ${response.status}`);
  }
  return response;
}

function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

async function paginate<T>(
  deps: Dependencies,
  path: string,
  token: string,
  select: (payload: unknown) => T[],
): Promise<T[]> {
  const first = new URL(`${API}${path}`);
  first.searchParams.set("per_page", String(PER_PAGE));
  const items: T[] = [];
  let url: string | undefined = first.toString();
  let pageNumber = 1;
  while (url) {
    const response = await request(deps, "GET", url, `Bearer ${token}`);
    const page = select(await response.json());
    items.push(...page);
    const next = nextLink(response.headers.get("Link"));
    if (next) {
      url = next;
      continue;
    }
    if (page.length < PER_PAGE) return items;
    pageNumber += 1;
    const following = new URL(first);
    following.searchParams.set("page", String(pageNumber));
    url = following.toString();
  }
  return items;
}

export async function installationToken(
  input: { appId: string; privateKeyPem: string; installationId: number },
  deps: Dependencies,
): Promise<string> {
  const jwt = createAppJwt({ appId: input.appId, privateKeyPem: input.privateKeyPem });
  const response = await request(
    deps,
    "POST",
    `${API}/app/installations/${input.installationId}/access_tokens`,
    `Bearer ${jwt}`,
  );
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) throw new Error("GitHub installation token response has no token");
  return payload.token;
}

export async function listInstallationRepositories(
  token: string,
  deps: Dependencies,
): Promise<InstallationRepository[]> {
  return paginate(deps, "/installation/repositories", token, (payload) =>
    ((payload as { repositories?: unknown[] }).repositories ?? []).map((entry) => {
      const repository = entry as { name: string; full_name: string; private: boolean };
      return {
        owner: repository.full_name.split("/")[0]!,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
      };
    }),
  );
}

export async function listOpenPullRequestsByAuthor(
  token: string,
  repositories: InstallationRepository[],
  login: string,
  deps: Dependencies,
): Promise<OpenPullRequest[]> {
  const results: OpenPullRequest[][] = [];
  for (let start = 0; start < repositories.length; start += CONCURRENCY) {
    const batch = repositories.slice(start, start + CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map((repository) => openPullRequests(token, repository, login, deps)),
      )),
    );
  }
  return results.flat();
}

async function openPullRequests(
  token: string,
  repository: InstallationRepository,
  login: string,
  deps: Dependencies,
): Promise<OpenPullRequest[]> {
  const pulls = await paginate(
    deps,
    `/repos/${repository.owner}/${repository.name}/pulls?state=open`,
    token,
    (payload) =>
      payload as {
        number: number;
        title: string;
        updated_at: string;
        html_url: string;
        user: { login: string } | null;
        head: { ref: string; sha: string };
      }[],
  );
  return pulls
    .filter((pull) => pull.user?.login === login)
    .map((pull) => ({
      owner: repository.owner,
      repo: repository.name,
      number: pull.number,
      title: pull.title,
      headRef: pull.head.ref,
      headSha: pull.head.sha,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
    }));
}
