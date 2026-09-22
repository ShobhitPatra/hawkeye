import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt, type PriorFinding, type PromptInput } from "./contract/prompt.js";
import { parseReviewResult, type ReviewResult } from "./contract/schema.js";
import type { HarnessSpec } from "./harness/harness.js";
import type { RunResultStatus } from "./runner/protocol.js";
import { removeTrustedConfig } from "./worktree/trusted-files.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

export type ReviewPipelineInput = {
  signal?: AbortSignal;
  deadline?: AbortSignal;
  startedAt?: number;
  cloneUrl: string;
  token: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  model?: string;
  depth?: number;
  previousRound?: { headSha: string; findings: PriorFinding[] };
  prompt: Omit<PromptInput, "repositoryRules" | "diff" | "resultPath" | "previousRound">;
};
export type ReviewPipelineDependencies = {
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
  onTurn?(turns: number): void;
};
export type ReviewPipelineOutcome =
  | { status: "ok"; turns: number; result: ReviewResult; diff: string; refusedModel?: string }
  | {
      status: Exclude<RunResultStatus, "ok">;
      turns: number;
      error: string;
      diff: string;
      refusedModel?: string;
    };

export function wallClockRanOut(wallClockMs: number, step: string) {
  return {
    status: "timeout" as const,
    turns: 0,
    error: `the wall clock of ${Math.round(wallClockMs / 60_000)} minutes ran out while ${step}`,
  };
}

export async function runReviewPipeline(
  input: ReviewPipelineInput,
  deps: ReviewPipelineDependencies,
): Promise<ReviewPipelineOutcome> {
  const { runDirectory, prompt } = input;
  const startedAt = input.startedAt ?? Date.now();
  let worktree: Awaited<ReturnType<typeof createWorktree>>;
  try {
    worktree = await deps.createWorktree({
      cloneUrl: input.cloneUrl,
      token: input.token,
      pullRequestNumber: prompt.pullRequest.number,
      headSha: prompt.pullRequest.headSha,
      baseSha: prompt.pullRequest.baseSha,
      directory: join(runDirectory, "checkout"),
      ...(input.depth === undefined ? {} : { depth: input.depth }),
      ...(input.previousRound === undefined
        ? {}
        : { previousHeadSha: input.previousRound.headSha }),
      ...(input.deadline === undefined ? {} : { signal: input.deadline }),
    });
  } catch (error) {
    if (!input.deadline?.aborted) throw error;
    return { ...wallClockRanOut(input.wallClockMs, "preparing the checkout"), diff: "" };
  }
  try {
    const repositoryRules = await deps.readRepositoryRules(worktree.path);
    await removeTrustedConfig(worktree.path);
    const promptPath = join(runDirectory, "prompt.md");
    const resultPath = join(runDirectory, "result.json");
    const settingsPath = join(runDirectory, "settings.json");
    const streamPath = join(runDirectory, "stream.jsonl");

    await writeFile(
      promptPath,
      buildPrompt({
        ...prompt,
        repositoryRules,
        diff: worktree.diff,
        resultPath,
        ...(input.previousRound === undefined
          ? {}
          : {
              previousRound: {
                headSha: input.previousRound.headSha,
                findings: input.previousRound.findings,
                ...(worktree.interdiff === undefined ? {} : { interdiff: worktree.interdiff }),
              },
            }),
      }),
    );

    if (input.signal?.aborted)
      return {
        status: "superseded",
        turns: 0,
        error: "superseded by a newer push",
        diff: worktree.diff,
      };
    const streamLines: string[] = [];
    const runHarness = (model: string | undefined) =>
      deps.harness.run({
        cwd: worktree.path,
        promptPath,
        resultPath,
        settingsPath,
        maxTurns: input.maxTurns,
        wallClockMs: Math.max(input.wallClockMs - (Date.now() - startedAt), 0),
        ...(model === undefined ? {} : { model }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onEvent: (event) => {
          if (event.type === "stdout") streamLines.push(event.line);
          if (event.type === "turn") {
            deps.log(`turn ${event.turns}`);
            deps.onTurn?.(event.turns);
          }
        },
      });
    let harnessResult = await runHarness(input.model);
    const refusedModel = harnessResult.refusedModel;
    if (refusedModel !== undefined) {
      deps.log(`model ${refusedModel} was refused; reviewing on the CLI default`);
      harnessResult = await runHarness(undefined);
    }
    const fallback = refusedModel === undefined ? {} : { refusedModel };
    await writeFile(streamPath, streamLines.join("\n"));
    if (harnessResult.status !== "ok")
      return {
        status: harnessResult.status,
        turns: harnessResult.turns,
        error: harnessResult.error ?? "stopped without a message",
        diff: worktree.diff,
        ...fallback,
      };

    try {
      const result = parseReviewResult(JSON.parse(await readFile(resultPath, "utf8")));
      return { status: "ok", turns: harnessResult.turns, result, diff: worktree.diff, ...fallback };
    } catch (error) {
      return {
        status: "invalid-output",
        turns: harnessResult.turns,
        error: (error as Error).message,
        diff: worktree.diff,
        ...fallback,
      };
    }
  } finally {
    await worktree.remove();
  }
}
