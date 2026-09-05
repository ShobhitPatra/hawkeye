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
  it("fetches one token per installation and a title per pull request", async () => {
    const github = client();
    const titles = await pullRequestTitles(github, references);
    expect(github.installationTokenById).toHaveBeenCalledTimes(2);
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
    const titles = await pullRequestTitles(github, references);
    expect([...titles.keys()]).toEqual(["octo/repo#1"]);
  });
});
