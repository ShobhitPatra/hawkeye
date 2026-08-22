import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DIMENSIONS } from "./contract/schema.js";
import type { GitHubClient } from "./github/client.js";
import type { HarnessResult, HarnessSpec } from "./harness/harness.js";
import { runReview, type RunReviewDependencies, type RunReviewInput } from "./run.js";

const sha = "a".repeat(40);
const result = {
  verdict: "needs-work",
  summary: "s",
  dimensions: DIMENSIONS.map((name) => ({ name, assessment: "ok" })),
  findings: [{ path: "a.txt", line: 2, class: "polish", claim: "c", detail: "d" }],
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
    })),
    linkedIssue: vi.fn(async () => ({ number: 2, title: "I", body: "ib" })),
    reviews: vi.fn(async () => overrides.reviews ?? []),
    postReview: vi.fn(async () => ({ url: "https://github.com/o/r/pull/1#pullrequestreview-9" })),
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
  const createWorktree = vi.fn(async (i: { directory: string }) => ({
    path: i.directory,
    diff: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,2 @@\n one\n+two\n",
    remove: vi.fn(async () => {}),
  }));
  const readRepositoryRules = vi.fn(async () => [{ path: "AGENTS.md", content: "rules" }]);
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
      directory: join(i.runDirectory, "checkout"),
    });
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
    await expect(runReview(await input(), failing)).rejects.toThrow(/boom/);
    expect(failing.github.postReview).not.toHaveBeenCalled();
    const invalid = deps({ resultJson: { verdict: "ready" } });
    await expect(runReview(await input(), invalid)).rejects.toThrow(/Invalid review result/);
    expect(invalid.github.postReview).not.toHaveBeenCalled();
  });
  it("removes the checkout even on failure", async () => {
    const d = deps({ harnessStatus: "error" });
    await runReview(await input(), d).catch(() => {});
    const worktree = await d.createWorktree.mock.results[0]!.value;
    expect(worktree.remove).toHaveBeenCalled();
  });
});
