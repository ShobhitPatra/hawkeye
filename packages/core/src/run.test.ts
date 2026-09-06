import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LENSES } from "./contract/schema.js";
import { GitHubRequestError, type GitHubClient } from "./github/client.js";
import type { HarnessResult, HarnessSpec } from "./harness/harness.js";
import { runReview, type RunReviewDependencies, type RunReviewInput } from "./run.js";

const sha = "a".repeat(40);
const result = {
  verdict: "changes_needed",
  summary: "s",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [{ path: "a.txt", line: 2, severity: "should_fix", claim: "c", detail: "d" }],
};

function deps(
  overrides: Partial<
    RunReviewDependencies & {
      reviews: { authorLogin: string; body: string }[];
      resultJson: unknown;
      harnessStatus: "ok" | "error";
    }
  > = {},
) {
  const github: GitHubClient = {
    installationToken: vi.fn(async () => "ghs_t"),
    installationTokenById: vi.fn(async () => "ghs_t"),
    listInstallationRepositories: vi.fn(async () => []),
    listOpenPullRequestsByAuthor: vi.fn(async () => []),
    pullRequest: vi.fn(async () => ({
      number: 1,
      title: "T",
      body: "Closes #2",
      author: "alice",
      draft: false,
      headSha: sha,
      headRef: "feat",
      baseSha: "b".repeat(40),
      baseRef: "main",
      cloneUrl: "https://github.com/o/r.git",
      commits: 1,
    })),
    mergeBase: vi.fn(async () => "m".repeat(40)),
    linkedIssue: vi.fn(async () => ({ number: 2, title: "I", body: "ib" })),
    reviews: vi.fn(async () => overrides.reviews ?? []),
    postReview: vi.fn(async () => ({
      url: "https://github.com/o/r/pull/1#pullrequestreview-9",
      id: "9",
    })),
    updateReview: vi.fn(async () => {}),
    review: vi.fn(async () => ({ body: "" })),
    createCommitStatus: vi.fn(async () => {}),
  };
  const harness: HarnessSpec = {
    name: "fake",
    run: vi.fn(async (i): Promise<HarnessResult> => {
      if ((overrides.harnessStatus ?? "ok") === "error")
        return { status: "error", turns: 0, error: "boom" };
      await writeFile(i.resultPath, JSON.stringify(overrides.resultJson ?? result));
      return { status: "ok", turns: 2 };
    }),
  };
  const createWorktree = vi.fn(async (i: { directory: string }) => {
    await mkdir(join(i.directory, ".claude"), { recursive: true });
    await mkdir(join(i.directory, "packages", "x"), { recursive: true });
    await writeFile(join(i.directory, "CLAUDE.md"), "project memory");
    await writeFile(join(i.directory, ".claude", "settings.json"), "{}");
    await writeFile(join(i.directory, "packages", "x", "CLAUDE.md"), "nested memory");
    return {
      path: i.directory,
      diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
      remove: vi.fn(async () => {}),
    };
  });
  const readRepositoryRules = vi.fn(async () => [
    { path: "AGENTS.md", content: "RULES-FIXTURE-TEXT" },
  ]);
  return {
    github,
    harness,
    createWorktree: createWorktree as never,
    readRepositoryRules,
    log: () => {},
    ...overrides,
  } as RunReviewDependencies & {
    github: typeof github;
    harness: typeof harness;
    createWorktree: typeof createWorktree;
  };
}

async function input(overrides: Partial<RunReviewInput> = {}): Promise<RunReviewInput> {
  return {
    reference: { owner: "o", repo: "r", number: 1 },
    botLogin: "hawkeye-review[bot]",
    repositoryUrl: "https://github.com/ShobhitPatra/hawkeye",
    runDirectory: await mkdtemp(join(tmpdir(), "hawkeye-run-")),
    maxTurns: 5,
    wallClockMs: 1000,
    dryRun: false,
    force: false,
    ...overrides,
  };
}

describe("runReview", () => {
  it("posts a rendered review and writes artifacts", async () => {
    const d = deps();
    const i = await input();
    const outcome = await runReview(i, d);
    expect(outcome).toMatchObject({
      kind: "posted",
      url: expect.stringContaining("pullrequestreview-9"),
      headSha: sha,
      findings: 1,
      turns: expect.any(Number),
      result: expect.objectContaining({ verdict: expect.any(String) }),
    });
    const posted = (d.github.postReview as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(posted.comments).toHaveLength(1);
    expect(posted.body).toContain(`<!-- hawkeye: head=${sha} -->`);
    expect(await readFile(join(i.runDirectory, "prompt.md"), "utf8")).toContain("Closes #2");
    expect(JSON.parse(await readFile(join(i.runDirectory, "review.json"), "utf8")).event).toBe(
      "COMMENT",
    );
    expect(d.createWorktree.mock.calls[0]![0]).toMatchObject({
      token: "ghs_t",
      headSha: sha,
      baseSha: "m".repeat(40),
      depth: 2,
      directory: join(i.runDirectory, "checkout"),
    });
    expect(await readFile(join(i.runDirectory, "prompt.md"), "utf8")).toContain("m".repeat(40));
  });
  it("removes Claude config from the checkout after reading the repository rules", async () => {
    const d = deps();
    const i = await input();
    await runReview(i, d);
    const checkout = join(i.runDirectory, "checkout");
    await expect(stat(join(checkout, "CLAUDE.md"))).rejects.toThrow();
    await expect(stat(join(checkout, ".claude"))).rejects.toThrow();
    await expect(stat(join(checkout, "packages", "x", "CLAUDE.md"))).rejects.toThrow();
    const prompt = await readFile(join(i.runDirectory, "prompt.md"), "utf8");
    expect(prompt).toContain(
      "The checkout's CLAUDE.md, CLAUDE.local.md and .claude/ were removed before review",
    );
    expect(prompt).toContain("RULES-FIXTURE-TEXT");
  });
  it("passes a contract override into the prompt", async () => {
    const d = deps();
    const i = await input({ contractOverride: "CUSTOM RULES" });
    await runReview(i, d);
    expect(await readFile(join(i.runDirectory, "prompt.md"), "utf8")).toContain("CUSTOM RULES");
  });
  it("does not resolve the merge base when the head was already reviewed", async () => {
    const d = deps({
      reviews: [{ authorLogin: "hawkeye-review[bot]", body: `<!-- hawkeye: head=${sha} -->` }],
    });
    await runReview(await input(), d);
    expect(d.github.mergeBase).not.toHaveBeenCalled();
  });
  it("skips when already reviewed unless forced", async () => {
    const reviews = [{ authorLogin: "hawkeye-review[bot]", body: `<!-- hawkeye: head=${sha} -->` }];
    const d = deps({ reviews });
    expect(await runReview(await input(), d)).toEqual({ kind: "already-reviewed", headSha: sha });
    expect(d.harness.run).not.toHaveBeenCalled();
    const forced = deps({ reviews });
    expect((await runReview(await input({ force: true }), forced)).kind).toBe("posted");
  });
  it("dry run renders but never posts", async () => {
    const d = deps();
    const outcome = await runReview(await input({ dryRun: true }), d);
    expect(outcome.kind).toBe("dry-run");
    expect(d.github.postReview).not.toHaveBeenCalled();
  });
  it("posts nothing when the harness fails or the result is invalid", async () => {
    const failing = deps({ harnessStatus: "error" });
    await expect(runReview(await input(), failing)).rejects.toThrow(
      "Harness error: boom after 0 turns",
    );
    expect(failing.github.postReview).not.toHaveBeenCalled();
    const invalid = deps({ resultJson: { verdict: "ship" } });
    await expect(runReview(await input(), invalid)).rejects.toThrow(/Invalid review result/);
    expect(invalid.github.postReview).not.toHaveBeenCalled();
  });
  it("retries body-only when GitHub rejects the inline anchors with 422", async () => {
    const d = deps();
    const logged: string[] = [];
    d.log = (line) => logged.push(line);
    d.github.postReview = vi
      .fn()
      .mockRejectedValueOnce(
        new GitHubRequestError(
          422,
          "GitHub POST /repos/o/r/pulls/1/reviews failed: 422 Unprocessable Entity",
        ),
      )
      .mockResolvedValueOnce({ url: "https://github.com/o/r/pull/1#pullrequestreview-9", id: "9" });
    const i = await input();
    const outcome = await runReview(i, d);
    expect(outcome.kind).toBe("posted");
    const calls = (d.github.postReview as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]![1].comments).toEqual([]);
    expect(calls[1]![1].body).toContain("**c**");
    expect(logged).toContain("inline anchors rejected (422); posting body only");
    const written = JSON.parse(await readFile(join(i.runDirectory, "review.json"), "utf8"));
    expect(written.comments).toEqual([]);
  });
  it("propagates a non-422 post failure without retrying", async () => {
    const d = deps();
    d.github.postReview = vi
      .fn()
      .mockRejectedValue(new GitHubRequestError(500, "failed: 500 Server Error"));
    await expect(runReview(await input(), d)).rejects.toThrow(/500/);
    expect(d.github.postReview).toHaveBeenCalledTimes(1);
  });
  it("does not retry when an untyped error merely mentions 422", async () => {
    const d = deps();
    d.github.postReview = vi.fn().mockRejectedValue(new Error("boom 422 in the message"));
    await expect(runReview(await input(), d)).rejects.toThrow(/422/);
    expect(d.github.postReview).toHaveBeenCalledTimes(1);
  });
  it("removes the checkout even on failure", async () => {
    const d = deps({ harnessStatus: "error" });
    await runReview(await input(), d).catch(() => {});
    const worktree = await d.createWorktree.mock.results[0]!.value;
    expect(worktree.remove).toHaveBeenCalled();
  });
});
