import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LENSES } from "./contract/schema.js";
import type { HarnessResult, HarnessSpec } from "./harness/harness.js";
import { runReviewJob, type RunReviewJobDependencies, type RunReviewJobInput } from "./run-job.js";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const result = {
  verdict: "revise",
  summary: "s",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [{ path: "a.txt", line: 2, severity: "should_fix", claim: "c", detail: "d" }],
};

function deps(
  overrides: Partial<{
    resultJson: unknown;
    resultText: string;
    harnessResult: HarnessResult;
    pullRequestResponse: Response;
  }> = {},
) {
  const fetch = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      overrides.pullRequestResponse ??
      Response.json({
        number: 1,
        title: "T",
        body: "Closes #2",
        draft: false,
        user: { login: "alice" },
        head: { sha: "c".repeat(40), ref: "feature" },
        base: {
          sha: "d".repeat(40),
          ref: "main",
          repo: { clone_url: "https://github.com/o/r.git" },
        },
      }),
  );
  const harness: HarnessSpec = {
    name: "fake",
    run: vi.fn(async (i): Promise<HarnessResult> => {
      i.onEvent({ type: "stdout", line: "{}" });
      i.onEvent({ type: "turn", turns: 1 });
      if (overrides.harnessResult) return overrides.harnessResult;
      await writeFile(
        i.resultPath,
        overrides.resultText ?? JSON.stringify(overrides.resultJson ?? result),
      );
      return { status: "ok", turns: 2 };
    }),
  };
  const createWorktree = vi.fn(async (i: { directory: string }) => {
    await mkdir(join(i.directory, ".claude"), { recursive: true });
    await writeFile(join(i.directory, "CLAUDE.md"), "project memory");
    await writeFile(join(i.directory, ".claude", "settings.json"), "{}");
    return {
      path: i.directory,
      diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
      remove: vi.fn(async () => {}),
    };
  });
  const readRepositoryRules = vi.fn(async () => [
    { path: "AGENTS.md", content: "RULES-FIXTURE-TEXT" },
  ]);
  const built: RunReviewJobDependencies = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    harness,
    createWorktree: createWorktree as never,
    readRepositoryRules,
    log: () => {},
  };
  return Object.assign(built, { fetch, harness, createWorktree });
}

async function input(overrides: Partial<RunReviewJobInput> = {}): Promise<RunReviewJobInput> {
  return {
    reference: { owner: "o", repo: "r", number: 1 },
    headSha,
    baseSha,
    token: "ghs_t",
    runDirectory: await mkdtemp(join(tmpdir(), "hawkeye-job-")),
    maxTurns: 5,
    wallClockMs: 1000,
    ...overrides,
  };
}

describe("runReviewJob", () => {
  it("checks out the job head with the job token and returns the parsed result", async () => {
    const d = deps();
    const i = await input();
    const outcome = await runReviewJob(i, d);
    expect(outcome).toEqual({ status: "ok", turns: 2, result });
    expect(d.createWorktree.mock.calls[0]![0]).toEqual({
      cloneUrl: "https://github.com/o/r.git",
      token: "ghs_t",
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory: join(i.runDirectory, "checkout"),
    });
    const [url, init] = d.fetch.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/o/r/pulls/1");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer ghs_t");
    expect(await readFile(join(i.runDirectory, "stream.jsonl"), "utf8")).toBe("{}");
  });
  it("writes a prompt with the pull request text, rules and diff but no linked issue", async () => {
    const d = deps();
    const i = await input({ contractOverride: "CUSTOM RULES" });
    await runReviewJob(i, d);
    const prompt = await readFile(join(i.runDirectory, "prompt.md"), "utf8");
    expect(prompt).toContain("Author: alice");
    expect(prompt).toContain("Title: T");
    expect(prompt).toContain("Closes #2");
    expect(prompt).not.toContain("# Linked issue");
    expect(prompt).toContain("RULES-FIXTURE-TEXT");
    expect(prompt).toContain("+two");
    expect(prompt).toContain("CUSTOM RULES");
    expect(prompt).toContain(headSha);
    expect(prompt).toContain(baseSha);
  });
  it("removes Claude config from the checkout after reading the repository rules", async () => {
    const d = deps();
    const i = await input();
    await runReviewJob(i, d);
    await expect(stat(join(i.runDirectory, "checkout", "CLAUDE.md"))).rejects.toThrow();
    await expect(stat(join(i.runDirectory, "checkout", ".claude"))).rejects.toThrow();
    expect(d.readRepositoryRules).toHaveBeenCalledWith(join(i.runDirectory, "checkout"));
  });
  it("reports turns as they happen", async () => {
    const d = deps();
    const turns: number[] = [];
    const logged: string[] = [];
    d.onTurn = (n) => turns.push(n);
    d.log = (line) => logged.push(line);
    await runReviewJob(await input(), d);
    expect(turns).toEqual([1]);
    expect(logged).toContain("turn 1");
  });
  it("returns the harness status and error when the harness does not finish", async () => {
    const d = deps({ harnessResult: { status: "timeout", turns: 3 } });
    expect(await runReviewJob(await input(), d)).toEqual({
      status: "timeout",
      turns: 3,
      error: "stopped without a message",
    });
    const failing = deps({ harnessResult: { status: "error", turns: 0, error: "boom" } });
    expect(await runReviewJob(await input(), failing)).toEqual({
      status: "error",
      turns: 0,
      error: "boom",
    });
  });
  it("returns invalid-output when the result does not match the schema or is not JSON", async () => {
    const invalid = deps({ resultJson: { verdict: "ship" } });
    expect(await runReviewJob(await input(), invalid)).toMatchObject({
      status: "invalid-output",
      turns: 2,
      error: expect.stringContaining("Invalid review result"),
    });
    const garbage = deps({ resultText: "not json" });
    expect(await runReviewJob(await input(), garbage)).toMatchObject({
      status: "invalid-output",
      turns: 2,
    });
  });
  it("throws when GitHub rejects the job token", async () => {
    const d = deps({
      pullRequestResponse: Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    await expect(runReviewJob(await input(), d)).rejects.toThrow(
      "GitHub GET /repos/o/r/pulls/1 failed: 401 Bad credentials",
    );
    expect(d.createWorktree).not.toHaveBeenCalled();
  });
  it("removes the checkout even when the harness fails", async () => {
    const d = deps({ harnessResult: { status: "error", turns: 0, error: "boom" } });
    await runReviewJob(await input(), d);
    const worktree = await d.createWorktree.mock.results[0]!.value;
    expect(worktree.remove).toHaveBeenCalled();
  });
});
