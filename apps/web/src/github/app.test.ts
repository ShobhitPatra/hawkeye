import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  installationToken,
  listInstallationRepositories,
  listOpenPullRequestsByAuthor,
  type InstallationRepository,
} from "./app";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

function fakeFetch(
  routes: Record<
    string,
    (url: URL, init: RequestInit) => { status?: number; json: unknown; link?: string | undefined }
  >,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    calls.push({ url: String(url), init });
    const route = routes[`${init.method ?? "GET"} ${parsed.pathname}`];
    if (!route) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const { status = 200, json, link } = route(parsed, init);
    return new Response(JSON.stringify(json), { status, headers: link ? { Link: link } : {} });
  });
  return { deps: { fetch: fetchImpl as unknown as typeof fetch }, calls };
}

const repository = (fullName: string): InstallationRepository => ({
  owner: fullName.split("/")[0]!,
  name: fullName.split("/")[1]!,
  fullName,
  private: false,
});

const pull = (number: number, login: string) => ({
  number,
  title: `PR ${number}`,
  updated_at: "2026-01-01T00:00:00Z",
  html_url: `https://github.com/pull/${number}`,
  user: { login },
  head: { ref: `feat-${number}`, sha: `sha-${number}` },
});

describe("installationToken", () => {
  it("exchanges an app jwt for an installation token", async () => {
    const { deps, calls } = fakeFetch({
      "POST /app/installations/155/access_tokens": () => ({
        status: 201,
        json: { token: "ghs_x" },
      }),
    });
    await expect(
      installationToken({ appId: "1", privateKeyPem: pem, installationId: 155 }, deps),
    ).resolves.toBe("ghs_x");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/);
  });

  it("rejects a token response without a token", async () => {
    const { deps } = fakeFetch({
      "POST /app/installations/155/access_tokens": () => ({ status: 201, json: {} }),
    });
    await expect(
      installationToken({ appId: "1", privateKeyPem: pem, installationId: 155 }, deps),
    ).rejects.toThrow(/no token/);
  });

  it("throws without leaking credentials on a non-2xx response", async () => {
    const { deps } = fakeFetch({
      "POST /app/installations/155/access_tokens": () => ({
        status: 401,
        json: { message: "Bad credentials" },
      }),
    });
    const error = await installationToken(
      { appId: "1", privateKeyPem: pem, installationId: 155 },
      deps,
    ).catch((caught: Error) => caught);
    expect(String(error)).toBe(
      "Error: GitHub POST /app/installations/155/access_tokens failed: 401",
    );
    expect(String(error)).not.toContain("BEGIN RSA");
  });
});

describe("listInstallationRepositories", () => {
  it("follows the link header across pages", async () => {
    const { deps, calls } = fakeFetch({
      "GET /installation/repositories": (url) => ({
        json: {
          repositories:
            url.searchParams.get("page") === "2"
              ? [{ name: "b", full_name: "o/b", private: true }]
              : [{ name: "a", full_name: "o/a", private: false }],
        },
        link:
          url.searchParams.get("page") === "2"
            ? undefined
            : '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
      }),
    });
    await expect(listInstallationRepositories("ghs_x", deps)).resolves.toEqual([
      { owner: "o", name: "a", fullName: "o/a", private: false },
      { owner: "o", name: "b", fullName: "o/b", private: true },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("per_page=100");
  });

  it("pages until a short page when no link header is sent", async () => {
    const full = Array.from({ length: 100 }, (_value, index) => ({
      name: `r${index}`,
      full_name: `o/r${index}`,
      private: false,
    }));
    const { deps, calls } = fakeFetch({
      "GET /installation/repositories": (url) => ({
        json: {
          repositories:
            url.searchParams.get("page") === "2"
              ? [{ name: "last", full_name: "o/last", private: false }]
              : full,
        },
      }),
    });
    const repositories = await listInstallationRepositories("ghs_x", deps);
    expect(repositories).toHaveLength(101);
    expect(repositories[100]!.fullName).toBe("o/last");
    expect(calls[1]!.url).toContain("page=2");
  });

  it("throws without leaking the token on a non-2xx response", async () => {
    const { deps } = fakeFetch({
      "GET /installation/repositories": () => ({ status: 403, json: { message: "Forbidden" } }),
    });
    const error = await listInstallationRepositories("ghs_secret", deps).catch(
      (caught: Error) => caught,
    );
    expect(String(error)).toBe("Error: GitHub GET /installation/repositories failed: 403");
    expect(String(error)).not.toContain("ghs_secret");
  });
});

describe("listOpenPullRequestsByAuthor", () => {
  it("collects the author's open pull requests across repositories", async () => {
    const { deps, calls } = fakeFetch({
      "GET /repos/o/a/pulls": () => ({ json: [pull(1, "ShobhitPatra"), pull(2, "other")] }),
      "GET /repos/o/b/pulls": () => ({ json: [pull(3, "ShobhitPatra")] }),
    });
    await expect(
      listOpenPullRequestsByAuthor(
        "ghs_x",
        [repository("o/a"), repository("o/b")],
        "ShobhitPatra",
        deps,
      ),
    ).resolves.toEqual([
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

  it("keeps repository order while batching more than the concurrency limit", async () => {
    const names = Array.from({ length: 7 }, (_value, index) => `o/r${index}`);
    const routes = Object.fromEntries(
      names.map((fullName, index) => [
        `GET /repos/${fullName}/pulls`,
        () => ({ json: [pull(index, "ShobhitPatra")] }),
      ]),
    );
    const { deps } = fakeFetch(routes);
    const pulls = await listOpenPullRequestsByAuthor(
      "ghs_x",
      names.map(repository),
      "ShobhitPatra",
      deps,
    );
    expect(pulls.map((entry) => entry.number)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("ignores pull requests whose author account was deleted", async () => {
    const { deps } = fakeFetch({
      "GET /repos/o/a/pulls": () => ({
        json: [{ ...pull(1, "ShobhitPatra"), user: null }, pull(2, "ShobhitPatra")],
      }),
    });
    const pulls = await listOpenPullRequestsByAuthor(
      "ghs_x",
      [repository("o/a")],
      "ShobhitPatra",
      deps,
    );
    expect(pulls.map((entry) => entry.number)).toEqual([2]);
  });
});
