import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt } from "./contract/prompt.js";
import { parseReviewResult } from "./contract/schema.js";
import type { GitHubClient } from "./github/client.js";
import type { PullRequestReference } from "./github/pull-request-reference.js";
import type { HarnessSpec } from "./harness/harness.js";
import { writeHarnessSettings } from "./harness/claude-code.js";
import { commentableLines } from "./review/diff-lines.js";
import { alreadyReviewed } from "./review/idempotency.js";
import { renderReview, type RenderedReview } from "./review/render.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

export type RunReviewInput = {
  reference: PullRequestReference;
  botLogin: string;
  repositoryUrl: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  dryRun: boolean;
  force: boolean;
};
export type RunReviewDependencies = {
  github: GitHubClient;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
};
export type RunReviewOutcome =
  | { kind: "posted"; url: string; headSha: string; findings: number }
  | { kind: "dry-run"; review: RenderedReview; headSha: string }
  | { kind: "already-reviewed"; headSha: string };

export async function runReview(
  input: RunReviewInput,
  deps: RunReviewDependencies,
): Promise<RunReviewOutcome> {
  const { reference, runDirectory } = input;
  const token = await deps.github.installationToken(reference);
  const pullRequest = await deps.github.pullRequest(reference, token);
  deps.log(
    `PR #${pullRequest.number} "${pullRequest.title}" head ${pullRequest.headSha.slice(0, 7)} base ${pullRequest.baseSha.slice(0, 7)}`,
  );

  if (
    !input.force &&
    alreadyReviewed(
      await deps.github.reviews(reference, token),
      pullRequest.headSha,
      input.botLogin,
    )
  ) {
    return { kind: "already-reviewed", headSha: pullRequest.headSha };
  }

  const worktree = await deps.createWorktree({
    cloneUrl: pullRequest.cloneUrl,
    token,
    pullRequestNumber: pullRequest.number,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    directory: join(runDirectory, "checkout"),
  });
  try {
    const [linkedIssue, repositoryRules] = await Promise.all([
      deps.github.linkedIssue(reference, pullRequest.body, token),
      deps.readRepositoryRules(worktree.path),
    ]);
    const promptPath = join(runDirectory, "prompt.md");
    const resultPath = join(runDirectory, "result.json");
    const settingsPath = join(runDirectory, "settings.json");
    const streamPath = join(runDirectory, "stream.jsonl");

    await writeFile(
      promptPath,
      buildPrompt({
        repository: { owner: reference.owner, repo: reference.repo },
        pullRequest: {
          number: pullRequest.number,
          title: pullRequest.title,
          body: pullRequest.body,
          author: pullRequest.author,
          baseSha: pullRequest.baseSha,
          headSha: pullRequest.headSha,
        },
        ...(linkedIssue ? { linkedIssue } : {}),
        repositoryRules,
        diff: worktree.diff,
        resultPath,
      }),
    );
    await writeHarnessSettings(settingsPath, resultPath);

    const streamLines: string[] = [];
    const harnessResult = await deps.harness.run({
      cwd: worktree.path,
      promptPath,
      resultPath,
      settingsPath,
      maxTurns: input.maxTurns,
      wallClockMs: input.wallClockMs,
      onEvent: (event) => {
        if (event.type === "stdout") streamLines.push(event.line);
        if (event.type === "turn") deps.log(`turn ${event.turns}`);
      },
    });
    await writeFile(streamPath, streamLines.join("\n"));
    if (harnessResult.status !== "ok")
      throw new Error(
        `Harness ${harnessResult.status}${harnessResult.error ? `: ${harnessResult.error}` : ""} after ${harnessResult.turns} turns`,
      );

    const result = parseReviewResult(JSON.parse(await readFile(resultPath, "utf8")));
    const render = (commentable: Map<string, Set<number>>) =>
      renderReview({
        result,
        headSha: pullRequest.headSha,
        commentable,
        repositoryUrl: input.repositoryUrl,
      });
    const reviewPath = join(runDirectory, "review.json");
    const review = render(commentableLines(worktree.diff));
    await writeFile(reviewPath, JSON.stringify(review, null, 2));

    if (input.dryRun) return { kind: "dry-run", review, headSha: pullRequest.headSha };
    const posted = await deps.github.postReview(reference, review, token).catch(async (error) => {
      if (!(error as Error).message.includes("422") || review.comments.length === 0) throw error;
      deps.log("inline anchors rejected (422); posting body only");
      const bodyOnly = render(new Map());
      await writeFile(reviewPath, JSON.stringify(bodyOnly, null, 2));
      return deps.github.postReview(reference, bodyOnly, token);
    });
    return {
      kind: "posted",
      url: posted.url,
      headSha: pullRequest.headSha,
      findings: result.findings.length,
    };
  } finally {
    await worktree.remove();
  }
}
