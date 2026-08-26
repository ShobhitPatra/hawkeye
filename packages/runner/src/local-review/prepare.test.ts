import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type createWorktree, findingId } from "@hawkeye/core";
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
  return {
    path: input.directory,
    diff,
    ...(input.previousHeadSha === undefined ? {} : { interdiff: "diff --git a/y b/y\n+later" }),
    remove: async () => {},
  };
};
const LENSES = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const firstResult = {
  verdict: "changes_needed",
  summary: "- one bug",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [
    { path: "x.ts", line: 1, severity: "should_fix", claim: "Bug", detail: "wrong" },
    { severity: "optional", claim: "Nit", detail: "small" },
  ],
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
  it("reviews round two against the latest completed round", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const createWorktreeSpy = vi.fn(fakeCreateWorktree);
    const first = await prepareRound({ reference, token: "t", root }, deps);
    await writeFile(first.resultPath, JSON.stringify(firstResult));
    await writeFile(
      join(first.directory, "dismissed.json"),
      JSON.stringify({ [findingId(undefined, "Nit")]: "we like it" }),
    );
    const second = await prepareRound(
      { reference, token: "t", root },
      { ...deps, createWorktree: createWorktreeSpy },
    );
    expect(createWorktreeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ previousHeadSha: headSha }),
    );
    const prompt = await readFile(join(second.directory, "prompt.md"), "utf8");
    expect(prompt).toContain(`- [${findingId("x.ts", "Bug")}] should_fix · Bug (x.ts:1)`);
    expect(prompt).toContain(
      `- [${findingId(undefined, "Nit")}] optional · Nit\n  dismissed by the author: we like it`,
    );
    expect(prompt).toContain("diff --git a/y b/y\n+later");
    expect(second.meta).toMatchObject({ round: 2, previousRound: 1, previousHeadSha: headSha });
    expect(JSON.parse(await readFile(join(second.directory, "meta.json"), "utf8"))).toMatchObject({
      previousRound: 1,
      previousHeadSha: headSha,
    });
    expect(describePreparedRound(second)[0]).toBe(
      "round 2 for o/r#7 at aaaaaaa (after round 1 at aaaaaaa)",
    );
  });
  it("starts a plain round when no earlier round has a result and warns about a broken one", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const createWorktreeSpy = vi.fn(fakeCreateWorktree);
    const first = await prepareRound({ reference, token: "t", root }, deps);
    await writeFile(first.resultPath, "{");
    const warnings: string[] = [];
    const second = await prepareRound(
      { reference, token: "t", root },
      { ...deps, createWorktree: createWorktreeSpy, warn: (line) => warnings.push(line) },
    );
    expect(createWorktreeSpy.mock.calls[0]?.[0]).not.toHaveProperty("previousHeadSha");
    expect(await readFile(join(second.directory, "prompt.md"), "utf8")).not.toContain(
      "# Previous round",
    );
    expect(second.meta).not.toHaveProperty("previousRound");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`skipping ${first.directory}`);
  });
});
