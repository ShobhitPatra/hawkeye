import { createAppJwt } from "./app-auth.js";
import type { PullRequestReference } from "./pull-request-reference.js";
import type { ExistingReview } from "../review/idempotency.js";
import type { RenderedReview } from "../review/render.js";

export type PullRequestDetails = {
  number: number;
  title: string;
  body: string;
  author: string;
  draft: boolean;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
  cloneUrl: string;
  commits: number;
};
export type LinkedIssue = { number: number; title: string; body: string };

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

export class GitHubRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

export interface GitHubClient {
  installationToken(reference: PullRequestReference): Promise<string>;
  installationTokenById(installationId: string): Promise<string>;
  pullRequest(reference: PullRequestReference, token: string): Promise<PullRequestDetails>;
  mergeBase(
    reference: PullRequestReference,
    baseSha: string,
    headSha: string,
    token: string,
  ): Promise<string>;
  linkedIssue(
    reference: PullRequestReference,
    body: string,
    token: string,
  ): Promise<LinkedIssue | undefined>;
  reviews(reference: PullRequestReference, token: string): Promise<ExistingReview[]>;
  postReview(
    reference: PullRequestReference,
    review: RenderedReview,
    token: string,
  ): Promise<{ url: string; id: string }>;
  listInstallationRepositories(token: string): Promise<InstallationRepository[]>;
  listOpenPullRequestsByAuthor(
    token: string,
    repositories: { owner: string; name: string }[],
    login: string,
  ): Promise<OpenPullRequest[]>;
}

const LINKED_ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

export function linkedIssueNumber(body: string): number | undefined {
  const match = LINKED_ISSUE.exec(body);
  return match ? Number(match[1]) : undefined;
}

const bearer = (token: string) => `Bearer ${token}`;
const pulls = (r: PullRequestReference) => `/repos/${r.owner}/${r.repo}/pulls/${r.number}`;

const PER_PAGE = 100;
const CONCURRENCY = 5;

function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

const DEFAULT_API_BASE = "https://api.github.com";

async function sendGitHubRequest(
  fetchImpl: typeof fetch,
  method: string,
  url: string,
  auth: string,
  body?: unknown,
): Promise<{ payload: unknown; response: Response }> {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hawkeye",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok)
    throw new GitHubRequestError(
      response.status,
      `GitHub ${method} ${new URL(url).pathname} failed: ${response.status} ${payload.message ?? ""}`.trim(),
    );
  return { payload, response };
}

export async function fetchPullRequestDetails(
  deps: { fetch: typeof fetch; apiBase?: string },
  reference: PullRequestReference,
  token: string,
): Promise<PullRequestDetails> {
  const { payload } = await sendGitHubRequest(
    deps.fetch,
    "GET",
    `${deps.apiBase ?? DEFAULT_API_BASE}${pulls(reference)}`,
    bearer(token),
  );
  const pr = payload as {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    user: { login: string };
    head: { sha: string; ref: string };
    base: { sha: string; ref: string; repo: { clone_url: string } };
    commits: number;
  };
  if (!Number.isInteger(pr.commits))
    throw new Error(`GitHub GET ${pulls(reference)} returned no commits count`);
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    author: pr.user.login,
    draft: pr.draft,
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseSha: pr.base.sha,
    baseRef: pr.base.ref,
    cloneUrl: pr.base.repo.clone_url,
    commits: pr.commits,
  };
}

export async function fetchLinkedIssue(
  deps: { fetch: typeof fetch; apiBase?: string },
  reference: PullRequestReference,
  body: string,
  token: string,
): Promise<LinkedIssue | undefined> {
  const number = linkedIssueNumber(body);
  if (number === undefined) return undefined;
  const issue = await sendGitHubRequest(
    deps.fetch,
    "GET",
    `${deps.apiBase ?? DEFAULT_API_BASE}/repos/${reference.owner}/${reference.repo}/issues/${number}`,
    bearer(token),
  ).catch((error: unknown) => {
    if (error instanceof GitHubRequestError && error.status === 404) return undefined;
    throw error;
  });
  if (issue === undefined) return undefined;
  const payload = issue.payload as { number: number; title: string; body: string | null };
  return { number: payload.number, title: payload.title, body: payload.body ?? "" };
}

export async function fetchMergeBase(
  deps: { fetch: typeof fetch; apiBase?: string },
  reference: PullRequestReference,
  baseSha: string,
  headSha: string,
  token: string,
): Promise<string> {
  const path = `/repos/${reference.owner}/${reference.repo}/compare/${baseSha}...${headSha}`;
  const { payload } = await sendGitHubRequest(
    deps.fetch,
    "GET",
    `${deps.apiBase ?? DEFAULT_API_BASE}${path}`,
    bearer(token),
  );
  const sha = (payload as { merge_base_commit?: { sha?: unknown } }).merge_base_commit?.sha;
  if (typeof sha !== "string") throw new Error(`GitHub GET ${path} returned no merge base sha`);
  return sha;
}

export function createGitHubClient(input: {
  appId: string;
  privateKeyPem: string;
  fetch: typeof fetch;
  apiBase?: string;
}): GitHubClient {
  const apiBase = input.apiBase ?? DEFAULT_API_BASE;

  const send = (method: string, url: string, auth: string, body?: unknown) =>
    sendGitHubRequest(input.fetch, method, url, auth, body);

  async function request<T>(
    method: string,
    path: string,
    auth: string,
    body?: unknown,
  ): Promise<T> {
    const { payload } = await send(method, `${apiBase}${path}`, auth, body);
    return payload as T;
  }

  async function paginate<T>(
    path: string,
    token: string,
    select: (payload: unknown) => T[],
  ): Promise<T[]> {
    const first = new URL(`${apiBase}${path}`);
    first.searchParams.set("per_page", String(PER_PAGE));
    const items: T[] = [];
    let url: string | undefined = first.toString();
    while (url) {
      const { payload, response } = await send("GET", url, bearer(token));
      items.push(...select(payload));
      url = nextLink(response.headers.get("Link"));
    }
    return items;
  }

  async function openPullRequests(
    token: string,
    repository: { owner: string; name: string },
    login: string,
  ): Promise<OpenPullRequest[]> {
    const list = await paginate(
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
    return list
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

  async function installationAccessToken(installationId: string): Promise<string> {
    if (!/^\d+$/.test(installationId))
      throw new Error(`Invalid installation id: "${installationId}"`);
    const jwt = bearer(createAppJwt({ appId: input.appId, privateKeyPem: input.privateKeyPem }));
    const token = await request<{ token?: string }>(
      "POST",
      `/app/installations/${installationId}/access_tokens`,
      jwt,
      {},
    );
    if (typeof token.token !== "string")
      throw new Error("GitHub installation token response has no token");
    return token.token;
  }

  return {
    async installationToken(reference) {
      const jwt = bearer(createAppJwt({ appId: input.appId, privateKeyPem: input.privateKeyPem }));
      const installation = await request<{ id: number }>(
        "GET",
        `/repos/${reference.owner}/${reference.repo}/installation`,
        jwt,
      );
      return installationAccessToken(String(installation.id));
    },
    async installationTokenById(installationId) {
      return installationAccessToken(installationId);
    },
    pullRequest(reference, token) {
      return fetchPullRequestDetails({ fetch: input.fetch, apiBase }, reference, token);
    },
    mergeBase(reference, baseSha, headSha, token) {
      return fetchMergeBase({ fetch: input.fetch, apiBase }, reference, baseSha, headSha, token);
    },
    linkedIssue(reference, body, token) {
      return fetchLinkedIssue({ fetch: input.fetch, apiBase }, reference, body, token);
    },
    async reviews(reference, token) {
      return paginate(`${pulls(reference)}/reviews`, token, (payload) =>
        (payload as { user: { login: string } | null; body: string }[]).map((review) => ({
          authorLogin: review.user?.login ?? "",
          body: review.body ?? "",
        })),
      );
    },
    async postReview(reference, review, token) {
      const path = `${pulls(reference)}/reviews`;
      const posted = await request<{ html_url?: unknown; id?: unknown }>(
        "POST",
        path,
        bearer(token),
        review,
      );
      if (typeof posted.html_url !== "string")
        throw new Error(`GitHub POST ${path} returned no review url`);
      if (typeof posted.id !== "number")
        throw new Error(`GitHub POST ${path} returned no review id`);
      return { url: posted.html_url, id: String(posted.id) };
    },
    async listInstallationRepositories(token) {
      return paginate("/installation/repositories", token, (payload) =>
        (
          payload as {
            repositories: {
              name: string;
              full_name: string;
              private: boolean;
              owner: { login: string };
            }[];
          }
        ).repositories.map((repository) => ({
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          private: repository.private,
        })),
      );
    },
    async listOpenPullRequestsByAuthor(token, repositories, login) {
      const collected: OpenPullRequest[][] = [];
      for (let start = 0; start < repositories.length; start += CONCURRENCY) {
        collected.push(
          ...(await Promise.all(
            repositories
              .slice(start, start + CONCURRENCY)
              .map((repository) => openPullRequests(token, repository, login)),
          )),
        );
      }
      return collected.flat();
    },
  };
}
