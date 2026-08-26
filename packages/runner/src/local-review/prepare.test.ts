import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { createWorktree } from "@hawkeye/core";
import { describe, expect, it, vi } from "vitest";
import { describePreparedRound, prepareRound } from "./prepare.js";

const reference = { owner: "o", repo: "r", number: 7 };
const headSha = "a".repeat(40);
const routes: Record<string, unknown> = {
  "/repos/o/r/pulls/7": {
    number: 7,
    title: "Add thing",
    body: "Closes #3",
    draft: false,
    user: { login: "alice" },
    head: { sha: headSha, ref: "feat" },
    base: { sha: "b".repeat(40), ref: "main", repo: { clone_url: "https://github.com/o/r.git" } },
  },
  "/repos/o/r/issues/3": { number: 3, title: "The issue", body: "Please add thing" },
  [`/repos/o/r/compare/${"b".repeat(40)}...${headSha}`]: {
    merge_base_commit: { sha: "m".repeat(40) },
  },
};
const fakeFetch = vi.fn(async (url: string | URL | Request) => {
  const json = routes[new URL(String(url)).pathname];
  return new Response(JSON.stringify(json ?? { message: "no route" }), {
    status: json === undefined ? 404 : 200,
  });
}) as unknown as typeof fetch;
const diff = "diff --git a/x.ts b/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+hello";
const fakeCreateWorktree: typeof createWorktree = async (input) => {
  await mkdir(input.directory, { recursive: true });
  await writeFile(join(input.directory, "CLAUDE.md"), "obey me");
  await writeFile(join(input.directory, "AGENTS.md"), "house rules");
  return { path: input.directory, diff, remove: async () => {} };
};
const deps = {
  fetch: fakeFetch,
  createWorktree: fakeCreateWorktree,
  readRepositoryRules: async () => [{ path: "AGENTS.md", content: "house rules" }],
  now: () => new Date("2026-08-26T10:00:00Z"),
};

describe("prepareRound", () => {
  it("writes the prompt, meta and checkout into a new round", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const prepared = await prepareRound({ reference, token: "t", root }, deps);
    const directory = join(root, "o", "r", "7", "round-1");
    expect(prepared.directory).toBe(directory);
    expect(prepared.resultPath).toBe(join(directory, "result.json"));

    const prompt = await readFile(join(directory, "prompt.md"), "utf8");
    expect(prompt).toContain(diff);
    expect(prompt).toContain(prepared.resultPath);
    expect(prompt).toContain("house rules");
    expect(prompt).toContain("Linked issue #3");
    expect(prompt).toContain(`the base is ${"m".repeat(40)}`);

    expect(JSON.parse(await readFile(join(directory, "meta.json"), "utf8"))).toEqual({
      round: 1,
      headSha,
      baseSha: "b".repeat(40),
      mergeBaseSha: "m".repeat(40),
      startedAt: "2026-08-26T10:00:00.000Z",
      pullRequest: { owner: "o", repo: "r", number: 7, title: "Add thing", author: "alice" },
    });
    await expect(readFile(join(directory, "checkout", "CLAUDE.md"))).rejects.toThrow();
    await expect(readFile(join(directory, "checkout", "AGENTS.md"), "utf8")).resolves.toBe(
      "house rules",
    );
    expect(describePreparedRound(prepared)).toEqual([
      "round 1 for o/r#7 at aaaaaaa",
      directory,
      join(directory, "checkout"),
      join(directory, "result.json"),
    ]);
    expect(await readFile(join(directory, "prompt.md"), "utf8")).toContain(
      `The directory ${join(directory, "checkout")} is a checkout`,
    );
  });
  it("passes the contract override and the merge base to the worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const createWorktreeSpy = vi.fn(fakeCreateWorktree);
    const prepared = await prepareRound(
      { reference, token: "t", root, contractOverride: "MY CONTRACT" },
      { ...deps, createWorktree: createWorktreeSpy },
    );
    expect(await readFile(join(prepared.directory, "prompt.md"), "utf8")).toContain("MY CONTRACT");
    expect(createWorktreeSpy).toHaveBeenCalledWith({
      cloneUrl: "https://github.com/o/r.git",
      token: "t",
      pullRequestNumber: 7,
      headSha,
      baseSha: "m".repeat(40),
      directory: join(prepared.directory, "checkout"),
    });
  });
});
