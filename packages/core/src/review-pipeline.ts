import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt, type PromptInput } from "./contract/prompt.js";
import { parseReviewResult, type ReviewResult } from "./contract/schema.js";
import type { HarnessSpec } from "./harness/harness.js";
import type { RunResultStatus } from "./runner/protocol.js";
import { removeTrustedConfig } from "./worktree/trusted-files.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

export type ReviewPipelineInput = {
  cloneUrl: string;
  token: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  prompt: Omit<PromptInput, "repositoryRules" | "diff" | "resultPath">;
};
export type ReviewPipelineDependencies = {
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
  onTurn?(turns: number): void;
};
export type ReviewPipelineOutcome =
  | { status: "ok"; turns: number; result: ReviewResult; diff: string }
  | { status: Exclude<RunResultStatus, "ok">; turns: number; error: string; diff: string };

export async function runReviewPipeline(
  input: ReviewPipelineInput,
  deps: ReviewPipelineDependencies,
): Promise<ReviewPipelineOutcome> {
  const { runDirectory, prompt } = input;
  const worktree = await deps.createWorktree({
    cloneUrl: input.cloneUrl,
    token: input.token,
    pullRequestNumber: prompt.pullRequest.number,
    headSha: prompt.pullRequest.headSha,
    baseSha: prompt.pullRequest.baseSha,
    directory: join(runDirectory, "checkout"),
  });
  try {
    const repositoryRules = await deps.readRepositoryRules(worktree.path);
    await removeTrustedConfig(worktree.path);
    const promptPath = join(runDirectory, "prompt.md");
    const resultPath = join(runDirectory, "result.json");
    const settingsPath = join(runDirectory, "settings.json");
    const streamPath = join(runDirectory, "stream.jsonl");

    await writeFile(
      promptPath,
      buildPrompt({ ...prompt, repositoryRules, diff: worktree.diff, resultPath }),
    );

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
        if (event.type === "turn") {
          deps.log(`turn ${event.turns}`);
          deps.onTurn?.(event.turns);
        }
      },
    });
    await writeFile(streamPath, streamLines.join("\n"));
    if (harnessResult.status !== "ok")
      return {
        status: harnessResult.status,
        turns: harnessResult.turns,
        error: harnessResult.error ?? "stopped without a message",
        diff: worktree.diff,
      };

    try {
      const result = parseReviewResult(JSON.parse(await readFile(resultPath, "utf8")));
      return { status: "ok", turns: harnessResult.turns, result, diff: worktree.diff };
    } catch (error) {
      return {
        status: "invalid-output",
        turns: harnessResult.turns,
        error: (error as Error).message,
        diff: worktree.diff,
      };
    }
  } finally {
    await worktree.remove();
  }
}
