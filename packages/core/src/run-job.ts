import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPrompt } from "./contract/prompt.js";
import { parseReviewResult, type ReviewResult } from "./contract/schema.js";
import { GitHubRequestError } from "./github/client.js";
import type { PullRequestReference } from "./github/pull-request-reference.js";
import type { HarnessSpec } from "./harness/harness.js";
import type { RunResultStatus } from "./runner/protocol.js";
import { removeTrustedConfig } from "./worktree/trusted-files.js";
import type { createWorktree, readRepositoryRules } from "./worktree/worktree.js";

const GITHUB_API_BASE = "https://api.github.com";

export type RunReviewJobInput = {
  reference: PullRequestReference;
  headSha: string;
  baseSha: string;
  token: string;
  runDirectory: string;
  maxTurns: number;
  wallClockMs: number;
  contractOverride?: string;
};
export type RunReviewJobDependencies = {
  fetch: typeof fetch;
  harness: HarnessSpec;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  log(line: string): void;
  onTurn?(turns: number): void;
};
export type RunReviewJobOutcome =
  | { status: "ok"; turns: number; result: ReviewResult }
  | { status: Exclude<RunResultStatus, "ok">; turns: number; error: string };

async function fetchPullRequestText(
  fetchImpl: typeof fetch,
  reference: PullRequestReference,
  token: string,
): Promise<{ title: string; body: string; author: string }> {
  const path = `/repos/${reference.owner}/${reference.repo}/pulls/${reference.number}`;
  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hawkeye",
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    title?: string;
    body?: string | null;
    user?: { login?: string } | null;
  };
  if (!response.ok)
    throw new GitHubRequestError(
      response.status,
      `GitHub GET ${path} failed: ${response.status} ${payload.message ?? ""}`.trim(),
    );
  return {
    title: payload.title ?? "",
    body: payload.body ?? "",
    author: payload.user?.login ?? "",
  };
}

export async function runReviewJob(
  input: RunReviewJobInput,
  deps: RunReviewJobDependencies,
): Promise<RunReviewJobOutcome> {
  const { reference, runDirectory } = input;
  const pullRequest = await fetchPullRequestText(deps.fetch, reference, input.token);
  const worktree = await deps.createWorktree({
    cloneUrl: `https://github.com/${reference.owner}/${reference.repo}.git`,
    token: input.token,
    pullRequestNumber: reference.number,
    headSha: input.headSha,
    baseSha: input.baseSha,
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
      buildPrompt({
        repository: { owner: reference.owner, repo: reference.repo },
        pullRequest: {
          number: reference.number,
          ...pullRequest,
          baseSha: input.baseSha,
          headSha: input.headSha,
        },
        repositoryRules,
        diff: worktree.diff,
        resultPath,
        ...(input.contractOverride === undefined
          ? {}
          : { contractOverride: input.contractOverride }),
      }),
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
        error: harnessResult.error ?? `harness ${harnessResult.status}`,
      };

    try {
      const result = parseReviewResult(JSON.parse(await readFile(resultPath, "utf8")));
      return { status: "ok", turns: harnessResult.turns, result };
    } catch (error) {
      return {
        status: "invalid-output",
        turns: harnessResult.turns,
        error: (error as Error).message,
      };
    }
  } finally {
    await worktree.remove();
  }
}
