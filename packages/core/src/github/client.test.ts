import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createGitHubClient, GitHubRequestError, linkedIssueNumber } from "./client.js";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
const ref = { owner: "o", repo: "r", number: 5 };
const reviewPage = (login: string, count: number) =>
  Array.from({ length: count }, () => ({ user: { login }, body: "b" }));

function fakeFetch(
  routes: Record<string, (init: RequestInit, url: URL) => { status?: number; json: unknown }>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const key = `${init.method ?? "GET"} ${parsed.pathname}`;
    calls.push({ url: String(url), init });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const { status = 200, json } = route(init, parsed);
    return new Response(JSON.stringify(json), { status });
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
    });
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
  it("lists reviews with author login and body, and posts a review", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews": () => ({
        json: [{ user: { login: "hawkeye-review[bot]" }, body: "<!-- hawkeye: head=aa -->" }],
      }),
      "POST /repos/o/r/pulls/5/reviews": () => ({
        json: { html_url: "https://github.com/o/r/pull/5#pullrequestreview-1" },
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    await expect(client.reviews(ref, "t")).resolves.toEqual([
      { authorLogin: "hawkeye-review[bot]", body: "<!-- hawkeye: head=aa -->" },
    ]);
    const posted = await client.postReview(
      ref,
      { event: "COMMENT", commit_id: "aa", body: "b", comments: [] },
      "t",
    );
    expect(posted.url).toContain("pullrequestreview-1");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      event: "COMMENT",
      commit_id: "aa",
      body: "b",
      comments: [],
    });
  });
  it("pages through reviews until a short page", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /repos/o/r/pulls/5/reviews": (_init, url) => ({
        json: url.searchParams.get("page") === "1" ? reviewPage("a", 100) : reviewPage("b", 1),
      }),
    });
    const client = createGitHubClient({ appId: "1", privateKeyPem: pem, fetch: fetchImpl });
    const reviews = await client.reviews(ref, "t");
    expect(reviews).toHaveLength(101);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("page=1");
    expect(calls[1]!.url).toContain("page=2");
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
});

describe("linkedIssueNumber", () => {
  it("finds closes/fixes/resolves", () => {
    expect(linkedIssueNumber("Closes #12")).toBe(12);
    expect(linkedIssueNumber("this RESOLVES #3 and #4")).toBe(3);
    expect(linkedIssueNumber("see #5")).toBeUndefined();
  });
});
