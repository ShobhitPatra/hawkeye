import { shortenHome } from "../terminal.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildPrompt,
  type createWorktree,
  fetchLinkedIssue,
  fetchMergeBase,
  fetchPullRequestDetails,
  type readRepositoryRules,
  removeTrustedConfig,
  type PullRequestReference,
} from "@hawkeye/core";
import {
  createRound,
  latestCompletedRound,
  pruneOlderCheckouts,
  pullRequestDirectory,
  priorFindingsBefore,
  type RoundMeta,
} from "./rounds.js";

export type { RoundMeta } from "./rounds.js";

export type PrepareInput = {
  reference: PullRequestReference;
  token: string;
  root: string;
  contractOverride?: string;
};
export type PrepareDependencies = {
  fetch: typeof fetch;
  createWorktree: typeof createWorktree;
  readRepositoryRules: typeof readRepositoryRules;
  now(): Date;
  warn?(line: string): void;
};
export type PreparedRound = {
  meta: RoundMeta;
  directory: string;
  resultPath: string;
  checkoutPath: string;
};

export async function prepareRound(
  input: PrepareInput,
  deps: PrepareDependencies,
): Promise<PreparedRound> {
  const { reference, token } = input;
  const github = { fetch: deps.fetch };
  const pullRequest = await fetchPullRequestDetails(github, reference, token);
  const mergeBaseSha = await fetchMergeBase(
    github,
    reference,
    pullRequest.baseSha,
    pullRequest.headSha,
    token,
  );
  const linkedIssue = await fetchLinkedIssue(github, reference, pullRequest.body, token);
  const pullRequestDir = pullRequestDirectory(input.root, reference);
  const previous = await latestCompletedRound(pullRequestDir, deps.warn);
  const { round, directory } = await createRound(pullRequestDir);
  const worktree = await deps.createWorktree({
    cloneUrl: pullRequest.cloneUrl,
    token,
    pullRequestNumber: pullRequest.number,
    headSha: pullRequest.headSha,
    baseSha: mergeBaseSha,
    depth: pullRequest.commits + 1,
    directory: join(directory, "checkout"),
    ...(previous === undefined ? {} : { previousHeadSha: previous.meta.headSha }),
  });
  const previousRound =
    previous === undefined
      ? undefined
      : {
          headSha: previous.meta.headSha,
          ...(worktree.interdiff === undefined ? {} : { interdiff: worktree.interdiff }),
          findings: await priorFindingsBefore(
            pullRequestDir,
            round,
            previous.result.findings,
            deps.warn,
          ),
        };
  const repositoryRules = await deps.readRepositoryRules(worktree.path);
  await removeTrustedConfig(worktree.path);
  const resultPath = join(directory, "result.json");
  await writeFile(
    join(directory, "prompt.md"),
    buildPrompt({
      repository: { owner: reference.owner, repo: reference.repo },
      pullRequest: {
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        author: pullRequest.author,
        baseSha: mergeBaseSha,
        headSha: pullRequest.headSha,
      },
      ...(linkedIssue ? { linkedIssue } : {}),
      repositoryRules,
      diff: worktree.diff,
      resultPath,
      checkoutPath: worktree.path,
      ...(previousRound === undefined ? {} : { previousRound }),
      ...(input.contractOverride === undefined ? {} : { contractOverride: input.contractOverride }),
    }),
  );
  const meta: RoundMeta = {
    round,
    headSha: pullRequest.headSha,
    baseSha: pullRequest.baseSha,
    mergeBaseSha,
    startedAt: deps.now().toISOString(),
    pullRequest: {
      owner: reference.owner,
      repo: reference.repo,
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.author,
    },
    ...(previousRound === undefined
      ? {}
      : {
          previousRound: previous!.meta.round,
          previousHeadSha: previous!.meta.headSha,
          carriedFindings: previousRound.findings.map((finding) => finding.id),
        }),
  };
  await writeFile(join(directory, "meta.json"), JSON.stringify(meta, null, 2));
  await pruneOlderCheckouts(pullRequestDir, round);
  return { meta, directory, resultPath, checkoutPath: worktree.path };
}

export function describePreparedRound(prepared: PreparedRound, home: string): string[] {
  const { meta } = prepared;
  const { owner, repo, number } = meta.pullRequest;
  const after =
    meta.previousRound === undefined || meta.previousHeadSha === undefined
      ? ""
      : `, after round ${meta.previousRound} at ${meta.previousHeadSha.slice(0, 7)}`;
  const path = (value: string) => shortenHome(value, home);
  return [
    `Round ${meta.round} for ${owner}/${repo}#${number} at ${meta.headSha.slice(0, 7)}${after}`,
    `  prompt    ${path(join(prepared.directory, "prompt.md"))}`,
    `  checkout  ${path(prepared.checkoutPath)}`,
    `  result    ${path(prepared.resultPath)}`,
    "",
    "Read the prompt, review the checkout, write the result, then",
    `hawkeye-review show ${path(prepared.directory)}`,
  ];
}
