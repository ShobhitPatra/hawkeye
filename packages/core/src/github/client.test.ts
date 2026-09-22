import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createGitHubClient,
  fetchMergeBase,
  GitHubRequestError,
  fetchPullRequestDetails,
  linkedIssueNumber,
} from "./client.js";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
const ref = { owner: "o", repo: "r", number: 5 };
const reviewPage = (login: string, count: number) =>
  Array.from({ length: count }, () => ({ user: { login }, body: "b" }));

const pull = (number: number, login: string | null) => ({
  number,
  title: `PR ${number}`,
  updated_at: "2026-01-01T00:00:00Z",
  html_url: `https://github.com/pull/${number}`,
  user: login === null ? null : { login },
  head: { ref: `feat-${number}`, sha: `sha-${number}` },
});

function fakeFetch(
  routes: Record<
    string,
    (init: RequestInit, url: URL) => { status?: number; json: unknown; link?: string | undefined }
  >,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const key = `${init.method ?? "GET"} ${parsed.pathname}`;
    calls.push({ url: String(url), init });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const { status = 200, json, link } = route(init, parsed);
    return new Response(JSON.stringify(json), { status, headers: link ? { Link: link } : {} });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("createGitHubClient", () => {
  it("exchanges an app jwt for an installation token", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/installation": () => ({ json: { id: 155 } }),
      "POST /app/installations/155/access_tokens": () => ({
        status: 201,
        json: { token: "ghs_x" },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.installationToken(ref)).resolves.toBe("ghs_x");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/);
  });
  it("bounds every request with an abort signal", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/installation": () => ({ json: { id: 155 } }),
      "POST /app/installations/155/access_tokens": () => ({
        status: 201,
        json: { token: "ghs_x" },
      }),
    });
    await createGitHubClient({
      appId: "1",
      privateKeyPem: pem,
      fetch: fetchImpl,
    }).installationToken(ref);
    for (const call of calls) expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("lists the installations a user token can access", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /user/installations": () => ({
        json: {
          total_count: 2,
          installations: [
            { id: 155, account: { login: "octo", type: "Organization" }, suspended_at: null },
            {
              id: 9,
              account: { login: "hubot", type: "User" },
              suspended_at: "2026-09-01T00:00:00Z",
            },
          ],
        },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.listUserInstallations("gho_user")).resolves.toEqual([
      { id: "155", accountLogin: "octo", accountType: "Organization", suspended: false },
      { id: "9", accountLogin: "hubot", accountType: "User", suspended: true },
    ]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer gho_user",
    );
    expect(calls[0]!.url).toContain("per_page=100");
  });

  it("maps pull request fields", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/pulls/5": () => ({
        json: {
          number: 5,
          title: "T",
          body: null,
          draft: false,
          user: { login: "alice" },
          head: { sha: "h", ref: "feat" },
          base: { sha: "b", ref: "main", repo: { clone_url: "https://github.com/o/r.git" } },
          commits: 3,
        },
      }),
    });
    const pr = await createGitHubClient({
      appId: "1",
      privateKeyPem: pem,
      fetch: fetchImpl,
    }).pullRequest(ref, "t");
    expect(pr).toEqual({
      number: 5,
      title: "T",
      body: "",
      author: "alice",
      draft: false,
      headSha: "h",
      headRef: "feat",
      baseSha: "b",
      baseRef: "main",
      cloneUrl: "https://github.com/o/r.git",
      commits: 3,
    });
  });
  it("rejects a pull request payload without a commits count", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/pulls/5": () => ({
        json: {
          number: 5,
          title: "T",
          body: null,
          draft: false,
          user: { login: "alice" },
          head: { sha: "h", ref: "feat" },
          base: { sha: "b", ref: "main", repo: { clone_url: "https://github.com/o/r.git" } },
        },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.pullRequest(ref, "t")).rejects.toThrow(/commits count/);
  });
  it("resolves the merge base of the base and head shas", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/compare/base...head": () => ({
        json: { merge_base_commit: { sha: "m".repeat(40) } },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.mergeBase(ref, "base", "head", "t")).resolves.toBe("m".repeat(40));
    expect(calls[0]!.url).toContain("/repos/o/r/compare/base...head");
  });
  it("rejects a comparison without a merge base sha", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/compare/base...head": () => ({ json: {} }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.mergeBase(ref, "base", "head", "t")).rejects.toThrow(/merge base/);
  });
  it("combines the caller's signal with the request timeout when fetching a pull request", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/pulls/5": () => ({
        json: {
          number: 5,
          title: "t",
          body: "",
          draft: false,
          user: { login: "a" },
          head: { sha: "h", ref: "b" },
          base: { sha: "b", ref: "main", repo: { clone_url: "https://github.com/o/r.git" } },
          commits: 1,
        },
      }),
    });
    const control = new AbortController();
    await fetchPullRequestDetails({ fetch: fetchImpl }, ref, "t", { signal: control.signal });
    const sent = calls[0]!.init.signal as AbortSignal;
    expect(sent.aborted).toBe(false);
    control.abort();
    expect(sent.aborted).toBe(true);
  });
  it("lists reviews with author login and body, and posts a review", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews": () => ({
        json: [
          { id: 77, user: { login: "hawkeye-review[bot]" }, body: "<!-- hawkeye: head=aa -->" },
        ],
      }),
      "POST /repos/o/r/pulls/5/reviews": () => ({
        json: { html_url: "https://github.com/o/r/pull/5#pullrequestreview-1", id: 1 },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.reviews(ref, "t")).resolves.toEqual([
      { authorLogin: "hawkeye-review[bot]", body: "<!-- hawkeye: head=aa -->", id: "77" },
    ]);
    const posted = await client.postReview(
      ref,
      { event: "COMMENT", commit_id: "aa", body: "b", comments: [] },
      "t",
    );
    expect(posted.url).toContain("pullrequestreview-1");
    expect(posted.id).toBe("1");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      event: "COMMENT",
      commit_id: "aa",
      body: "b",
      comments: [],
    });
  });
  it("asks GitHub once who the App is and answers its bot login", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /app": () => ({ json: { slug: "hawkeye-review" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.botLogin()).resolves.toBe("hawkeye-review[bot]");
    await expect(client.botLogin()).resolves.toBe("hawkeye-review[bot]");
    expect(calls).toHaveLength(1);
  });
  it("asks again after a failed lookup, and refuses an answer without a slug", async () => {
    let answers = 0;
    const { fetchImpl } = fakeFetch({
      "GET /app": () => ({ json: (answers += 1) === 1 ? {} : { slug: "hawkeye-review" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.botLogin()).rejects.toThrow("returned no slug");
    await expect(client.botLogin()).resolves.toBe("hawkeye-review[bot]");
  });
  it("tolerates reviews whose author account was deleted", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews": () => ({
        json: [
          { user: null, body: "x" },
          { user: { login: "alice" }, body: "y" },
        ],
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.reviews(ref, "t")).resolves.toEqual([
      { authorLogin: "", body: "x" },
      { authorLogin: "alice", body: "y" },
    ]);
  });
  it("follows the link header across review pages", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews": (_init, url) => ({
        json: url.searchParams.get("page") === "2" ? reviewPage("b", 1) : reviewPage("a", 100),
        link:
          url.searchParams.get("page") === "2"
            ? undefined
            : '<https://api.github.com/repos/o/r/pulls/5/reviews?per_page=100&page=2>; rel="next"',
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const reviews = await client.reviews(ref, "t");
    expect(reviews).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("per_page=100");
    expect(calls[1]!.url).toContain("page=2");
  });
  it("updates a review body with a put on the review", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "PUT /repos/o/r/pulls/5/reviews/9": () => ({ json: { id: 9 } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.updateReview(ref, "9", "new body", "t")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ body: "new body" });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });
  it("fetches one review's body", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews/9": () => ({ json: { id: 9, body: "hello" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.review(ref, "9", "t")).resolves.toEqual({ body: "hello" });
  });
  it("posts a commit status on the head under the given context", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /repos/o/r/statuses/abc123": () => ({ json: { id: 1 } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(
      client.createCommitStatus(
        ref,
        "abc123",
        { state: "pending", description: "Reviewing on laptop", context: "hawkeye" },
        "t",
      ),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      state: "pending",
      description: "Reviewing on laptop",
      context: "hawkeye",
    });
  });
  it("throws a typed error when the review update fails", async () => {
    const { fetchImpl } = fakeFetch({
      "PUT /repos/o/r/pulls/5/reviews/9": () => ({ status: 422, json: { message: "nope" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const err = await client.updateReview(ref, "9", "b", "ghs_secret").catch((e: Error) => e);
    expect(err).toBeInstanceOf(GitHubRequestError);
    expect(String(err)).toMatch(/422.*nope/);
    expect(String(err)).not.toContain("ghs_secret");
  });
  it("rejects a posted review without a numeric id", async () => {
    const { fetchImpl } = fakeFetch({
      "POST /repos/o/r/pulls/5/reviews": () => ({
        json: { html_url: "https://github.com/o/r/pull/5#pullrequestreview-1", id: "1" },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(
      client.postReview(ref, { event: "COMMENT", commit_id: "aa", body: "b", comments: [] }, "t"),
    ).rejects.toThrow(/review id/);
  });
  it("rejects a posted review without a url", async () => {
    const { fetchImpl } = fakeFetch({
      "POST /repos/o/r/pulls/5/reviews": () => ({ json: {} }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(
      client.postReview(ref, { event: "COMMENT", commit_id: "aa", body: "b", comments: [] }, "t"),
    ).rejects.toThrow(/review url/);
  });
  it("throws without leaking the token on non-2xx", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/pulls/5": () => ({ status: 403, json: { message: "Forbidden" } }),
    });
    const err = await createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl })
      .pullRequest(ref, "ghs_secret")
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/403.*Forbidden/);
    expect(String(err)).not.toContain("ghs_secret");
    expect(err).toBeInstanceOf(GitHubRequestError);
    expect((err as GitHubRequestError).status).toBe(403);
  });
  it("fetches the linked issue when the body closes one", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/issues/9": () => ({ json: { number: 9, title: "Bug", body: "desc" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.linkedIssue(ref, "Fixes #9 please", "t")).resolves.toEqual({
      number: 9,
      title: "Bug",
      body: "desc",
    });
    await expect(client.linkedIssue(ref, "no link", "t")).resolves.toBeUndefined();
  });
  it("treats a missing linked issue as absent but propagates other failures", async () => {
    const missing = fakeFetch({
      "GET /repos/o/r/issues/9": () => ({ status: 404, json: { message: "Not Found" } }),
    });
    await expect(
      createGitHubClient({
        appId: "1",
        privateKeyPem: pem,
        fetch: missing.fetchImpl,
      }).linkedIssue(ref, "Fixes #9", "t"),
    ).resolves.toBeUndefined();
    const broken = fakeFetch({
      "GET /repos/o/r/issues/9": () => ({ status: 500, json: { message: "Server Error" } }),
    });
    await expect(
      createGitHubClient({
        appId: "1",
        privateKeyPem: pem,
        fetch: broken.fetchImpl,
      }).linkedIssue(ref, "Fixes #9", "t"),
    ).rejects.toThrow(/500/);
  });

  it("exchanges an app jwt for an installation token by installation id", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /app/installations/155822984/access_tokens": () => ({
        status: 201,
        json: { token: "ghs_x" },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.installationTokenById("155822984")).resolves.toBe("ghs_x");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/);
  });
  it("rejects an installation token response without a token", async () => {
    const { fetchImpl } = fakeFetch({
      "POST /app/installations/155822984/access_tokens": () => ({ status: 201, json: {} }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.installationTokenById("155822984")).rejects.toThrow(/no token/);
  });
  it("lists installation repositories across link header pages", async () => {
    const full = Array.from({ length: 100 }, (_value, index) => ({
      name: `r${index}`,
      full_name: `o/r${index}`,
      private: false,
      owner: { login: "o" },
    }));
    const { fetchImpl, calls } = fakeFetch({
      "GET /installation/repositories": (_init, url) => ({
        json: {
          repositories:
            url.searchParams.get("page") === "2"
              ? [{ name: "b", full_name: "o/b", private: true, owner: { login: "o" } }]
              : full,
        },
        link:
          url.searchParams.get("page") === "2"
            ? undefined
            : '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const repositories = await client.listInstallationRepositories("ghs_x");
    expect(repositories).toHaveLength(101);
    expect(repositories[100]).toEqual({ owner: "o", name: "b", fullName: "o/b", private: true });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("per_page=100");
  });
  it("follows the next rel out of a link header listing multiple rels", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /installation/repositories": (_init, url) => ({
        json: {
          repositories:
            url.searchParams.get("page") === "2"
              ? [{ name: "z", full_name: "o/z", private: false, owner: { login: "o" } }]
              : [{ name: "a", full_name: "o/a", private: false, owner: { login: "o" } }],
        },
        link:
          url.searchParams.get("page") === "2"
            ? undefined
            : '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next", <https://api.github.com/installation/repositories?per_page=100&page=5>; rel="last"',
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const repositories = await client.listInstallationRepositories("ghs_x");
    expect(repositories).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain("page=2");
  });
  it("takes the repository owner from the owner field, not the full name", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /installation/repositories": () => ({
        json: {
          repositories: [
            { name: "r", full_name: "renamed-owner/r", private: false, owner: { login: "o" } },
          ],
        },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const repositories = await client.listInstallationRepositories("ghs_x");
    expect(repositories).toEqual([
      { owner: "o", name: "r", fullName: "renamed-owner/r", private: false },
    ]);
  });
  it("stops after a last link page holding exactly one hundred repositories", async () => {
    const full = Array.from({ length: 100 }, (_value, index) => ({
      name: `r${index}`,
      full_name: `o/r${index}`,
      private: false,
      owner: { login: "o" },
    }));
    const { fetchImpl, calls } = fakeFetch({
      "GET /installation/repositories": () => ({ json: { repositories: full } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.listInstallationRepositories("ghs_x")).resolves.toHaveLength(100);
    expect(calls).toHaveLength(1);
  });
  it("throws without leaking the token when listing repositories fails", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /installation/repositories": () => ({ status: 403, json: { message: "Forbidden" } }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const error = await client.listInstallationRepositories("ghs_secret").catch((e: Error) => e);
    expect(String(error)).toContain("GitHub GET /installation/repositories failed: 403 Forbidden");
    expect(String(error)).not.toContain("ghs_secret");
  });
  it("rejects an installation id that is not numeric", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.installationTokenById("../app")).rejects.toThrow(/installation id/);
    expect(calls).toHaveLength(0);
  });
  it("fetches pull requests for more repositories than the concurrency limit", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const routes = Object.fromEntries(
      names.map((n) => [`GET /repos/o/${n}/pulls`, () => ({ json: [pull(1, "alice")] })]),
    );
    const { fetchImpl, calls } = fakeFetch(routes);
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const open = await client.listOpenPullRequestsByAuthor(
      "ghs_x",
      names.map((name) => ({ owner: "o", name })),
      "alice",
    );
    expect(open.map((p) => p.repo)).toEqual(names);
    expect(calls).toHaveLength(names.length);
  });
  it("collects the author's open pull requests across repositories", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/a/pulls": () => ({ json: [pull(1, "alice"), pull(2, "bob"), pull(4, null)] }),
      "GET /repos/o/b/pulls": () => ({ json: [pull(3, "alice")] }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const open = await client.listOpenPullRequestsByAuthor(
      "ghs_x",
      [
        { owner: "o", name: "a" },
        { owner: "o", name: "b" },
      ],
      "alice",
    );
    expect(open).toEqual([
      {
        owner: "o",
        repo: "a",
        number: 1,
        title: "PR 1",
        headRef: "feat-1",
        headSha: "sha-1",
        updatedAt: "2026-01-01T00:00:00Z",
        htmlUrl: "https://github.com/pull/1",
      },
      {
        owner: "o",
        repo: "b",
        number: 3,
        title: "PR 3",
        headRef: "feat-3",
        headSha: "sha-3",
        updatedAt: "2026-01-01T00:00:00Z",
        htmlUrl: "https://github.com/pull/3",
      },
    ]);
    expect(calls[0]!.url).toContain("state=open");
  });
});

describe("fetchMergeBase", () => {
  it("resolves the merge base with a plain token", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/compare/base...head": () => ({
        json: { merge_base_commit: { sha: "m".repeat(40) } },
      }),
    });
    await expect(fetchMergeBase({ fetch: fetchImpl }, ref, "base", "head", "t")).resolves.toBe(
      "m".repeat(40),
    );
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/compare/base...head");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer t");
  });
  it("rejects a comparison without a merge base sha", async () => {
    const { fetchImpl } = fakeFetch({
      "GET /repos/o/r/compare/base...head": () => ({ json: {} }),
    });
    await expect(fetchMergeBase({ fetch: fetchImpl }, ref, "base", "head", "t")).rejects.toThrow(
      /merge base/,
    );
  });
});

describe("linkedIssueNumber", () => {
  it("finds closes/fixes/resolves", () => {
    expect(linkedIssueNumber("Closes #12")).toBe(12);
    expect(linkedIssueNumber("this RESOLVES #3 and #4")).toBe(3);
    expect(linkedIssueNumber("see #5")).toBeUndefined();
  });
});
