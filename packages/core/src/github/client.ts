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
};
export type LinkedIssue = { number: number; title: string; body: string };

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
  ): Promise<{ url: string }>;
}

const LINKED_ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i;

export function linkedIssueNumber(body: string): number | undefined {
  const match = LINKED_ISSUE.exec(body);
  return match ? Number(match[1]) : undefined;
}

export function createGitHubClient(input: {
  appId: string;
  privateKeyPem: string;
  fetch: typeof fetch;
  apiBase?: string;
}): GitHubClient {
  const apiBase = input.apiBase ?? "https://api.github.com";

  async function request<T>(
    method: string,
    path: string,
    auth: string,
    body?: unknown,
  ): Promise<T> {
    const response = await input.fetch(`${apiBase}${path}`, {
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
    const json = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok)
      throw new GitHubRequestError(
        response.status,
        `GitHub ${method} ${path} failed: ${response.status} ${json.message ?? ""}`.trim(),
      );
    return json as T;
  }

  const bearer = (token: string) => `Bearer ${token}`;
  const pulls = (r: PullRequestReference) => `/repos/${r.owner}/${r.repo}/pulls/${r.number}`;

  return {
    async installationToken(reference) {
      const jwt = bearer(createAppJwt({ appId: input.appId, privateKeyPem: input.privateKeyPem }));
      const installation = await request<{ id: number }>(
        "GET",
        `/repos/${reference.owner}/${reference.repo}/installation`,
        jwt,
      );
      const token = await request<{ token: string }>(
        "POST",
        `/app/installations/${installation.id}/access_tokens`,
        jwt,
        {},
      );
      return token.token;
    },
    async pullRequest(reference, token) {
      const pr = await request<{
        number: number;
        title: string;
        body: string | null;
        draft: boolean;
        user: { login: string };
        head: { sha: string; ref: string };
        base: { sha: string; ref: string; repo: { clone_url: string } };
      }>("GET", pulls(reference), bearer(token));
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
      };
    },
    async mergeBase(reference, baseSha, headSha, token) {
      const path = `/repos/${reference.owner}/${reference.repo}/compare/${baseSha}...${headSha}`;
      const comparison = await request<{ merge_base_commit?: { sha?: unknown } }>(
        "GET",
        path,
        bearer(token),
      );
      const sha = comparison.merge_base_commit?.sha;
      if (typeof sha !== "string") throw new Error(`GitHub GET ${path} returned no merge base sha`);
      return sha;
    },
    async linkedIssue(reference, body, token) {
      const number = linkedIssueNumber(body);
      if (number === undefined) return undefined;
      const issue = await request<{ number: number; title: string; body: string | null }>(
        "GET",
        `/repos/${reference.owner}/${reference.repo}/issues/${number}`,
        bearer(token),
      ).catch((error: unknown) => {
        if (error instanceof GitHubRequestError && error.status === 404) return undefined;
        throw error;
      });
      if (issue === undefined) return undefined;
      return { number: issue.number, title: issue.title, body: issue.body ?? "" };
    },
    async reviews(reference, token) {
      const all: ExistingReview[] = [];
      for (let page = 1; ; page += 1) {
        const list = await request<{ user: { login: string }; body: string }[]>(
          "GET",
          `${pulls(reference)}/reviews?per_page=100&page=${page}`,
          bearer(token),
        );
        all.push(...list.map((r) => ({ authorLogin: r.user.login, body: r.body ?? "" })));
        if (list.length < 100) return all;
      }
    },
    async postReview(reference, review, token) {
      const path = `${pulls(reference)}/reviews`;
      const posted = await request<{ html_url?: unknown }>("POST", path, bearer(token), review);
      if (typeof posted.html_url !== "string")
        throw new Error(`GitHub POST ${path} returned no review url`);
      return { url: posted.html_url };
    },
  };
}
