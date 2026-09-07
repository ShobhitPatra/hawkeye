import type { GitHubClient } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import { pullRequestTitles } from "./pull-request-titles";

const references = [
  { owner: "octo", repo: "repo", number: 1, installationId: "10" },
  { owner: "octo", repo: "repo", number: 2, installationId: "10" },
  { owner: "hub", repo: "other", number: 3, installationId: "20" },
];

type Fakes = {
  installationTokenById?: (id: string) => Promise<string>;
  pullRequest?: (reference: { number: number }) => Promise<{ title: string }>;
};

function client(overrides: Fakes = {}): GitHubClient {
  return {
    installationTokenById: vi.fn(
      overrides.installationTokenById ?? (async (id: string) => `token-${id}`),
    ),
    pullRequest: vi.fn(
      overrides.pullRequest ??
        (async (reference: { number: number }) => ({ title: `PR ${reference.number}` })),
    ),
  } as unknown as GitHubClient;
}

describe("pullRequestTitles", () => {
  it("fetches one token per installation and each pull request once", async () => {
    const github = client();
    const titles = await pullRequestTitles(github, [...references, references[0]!], {
      cache: new Map(),
    });
    expect(github.installationTokenById).toHaveBeenCalledTimes(2);
    expect(github.pullRequest).toHaveBeenCalledTimes(3);
    expect(titles.get("octo/repo#2")).toBe("PR 2");
    expect(titles.get("hub/other#3")).toBe("PR 3");
  });

  it("leaves out titles GitHub cannot provide instead of failing", async () => {
    const github = client({
      installationTokenById: async (id) => {
        if (id === "20") throw new Error("installation gone");
        return `token-${id}`;
      },
      pullRequest: async (reference) => {
        if (reference.number === 2) throw new Error("404");
        return { title: `PR ${reference.number}` };
      },
    });
    const titles = await pullRequestTitles(github, references, { cache: new Map() });
    expect([...titles.keys()]).toEqual(["octo/repo#1"]);
  });

  it("remembers a title for ten minutes and a refusal for fifteen seconds", async () => {
    const cache = new Map();
    const github = client({
      pullRequest: async (reference) => {
        if (reference.number === 2) throw new Error("404");
        return { title: `PR ${reference.number}` };
      },
    });
    const first = await pullRequestTitles(github, references, { cache, now: 0 });
    expect(first.get("octo/repo#1")).toBe("PR 1");
    expect(first.has("octo/repo#2")).toBe(false);
    await pullRequestTitles(github, references, { cache, now: 10_000 });
    expect(github.pullRequest).toHaveBeenCalledTimes(3);
    const again = await pullRequestTitles(github, references, { cache, now: 20_000 });
    expect(again.get("hub/other#3")).toBe("PR 3");
    expect(github.pullRequest).toHaveBeenCalledTimes(4);
    await pullRequestTitles(github, references, { cache, now: 11 * 60_000 });
    expect(github.pullRequest).toHaveBeenCalledTimes(7);
  });

  it("shares one fetch between renders that ask at the same time", async () => {
    const cache = new Map();
    const github = client();
    const [a, b] = await Promise.all([
      pullRequestTitles(github, references, { cache, now: 0 }),
      pullRequestTitles(github, references.slice(0, 1), { cache, now: 0 }),
    ]);
    expect(a.get("octo/repo#1")).toBe("PR 1");
    expect(b.get("octo/repo#1")).toBe("PR 1");
    expect(github.pullRequest).toHaveBeenCalledTimes(3);
  });
});
