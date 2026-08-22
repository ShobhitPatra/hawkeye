import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import {
  createClaudeCodeHarness,
  createGitHubClient,
  createWorktree,
  parsePullRequestReference,
  readRepositoryRules,
  runReview,
} from "@hawkeye/core";
import { loadConfig } from "./config.js";
import { createRunDirectory } from "./run-directory.js";

const CONFIG_PATH = join(homedir(), ".config", "hawkeye", "config.json");
const RUNS_ROOT = join(homedir(), ".cache", "hawkeye", "runs");
const REPOSITORY_URL = "https://github.com/ShobhitPatra/hawkeye";

function positiveInteger(flag: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

export function createProgram(io: {
  stdout(line: string): void;
  stderr(line: string): void;
}): Command {
  const program = new Command("hawkeye").description(
    "Personal code reviewer on your own Claude plan",
  );

  program
    .command("review")
    .argument("<pull-request>", "https://github.com/owner/repo/pull/N or owner/repo#N")
    .option("--dry-run", "render the review and print it without posting", false)
    .option("--force", "review even if this head sha was already reviewed", false)
    .option("--max-turns <n>", "assistant turn limit", "40")
    .option("--wall-clock-minutes <n>", "wall clock limit in minutes", "15")
    .action(
      async (
        pullRequest: string,
        options: { dryRun: boolean; force: boolean; maxTurns: string; wallClockMinutes: string },
      ) => {
        let runDirectory: string | undefined;
        let log = io.stderr;
        try {
          const maxTurns = positiveInteger("--max-turns", options.maxTurns);
          const wallClockMinutes = positiveInteger(
            "--wall-clock-minutes",
            options.wallClockMinutes,
          );
          const reference = parsePullRequestReference(pullRequest);
          const config = await loadConfig({
            env: process.env,
            configPath: CONFIG_PATH,
            readFile: (p) => readFile(p, "utf8"),
          });
          const privateKeyPem = await readFile(config.privateKeyPath, "utf8");
          const directory = await createRunDirectory({
            root: RUNS_ROOT,
            reference,
            now: new Date(),
          });
          runDirectory = directory;
          const logPath = join(directory, "log.txt");
          log = (line: string) => {
            io.stderr(line);
            appendFileSync(logPath, `${line}\n`);
          };
          log(`run directory: ${directory}`);

          const outcome = await runReview(
            {
              reference,
              botLogin: `${config.appSlug}[bot]`,
              repositoryUrl: REPOSITORY_URL,
              runDirectory: directory,
              maxTurns,
              wallClockMs: wallClockMinutes * 60_000,
              dryRun: options.dryRun,
              force: options.force,
            },
            {
              github: createGitHubClient({ appId: config.appId, privateKeyPem, fetch }),
              harness: createClaudeCodeHarness(),
              createWorktree,
              readRepositoryRules,
              log,
            },
          );

          if (outcome.kind === "already-reviewed")
            io.stdout(
              `already reviewed ${outcome.headSha.slice(0, 7)}; use --force to review again`,
            );
          if (outcome.kind === "dry-run")
            io.stdout(
              `${outcome.review.body}\n\n${outcome.review.comments.map((c) => `--- ${c.path}:${c.line}\n${c.body}`).join("\n\n")}`,
            );
          if (outcome.kind === "posted")
            io.stdout(`posted ${outcome.findings} finding(s): ${outcome.url}`);
        } catch (error) {
          log(`error: ${(error as Error).message}`);
          if (runDirectory) log(`run directory: ${runDirectory}`);
          process.exitCode = 1;
        }
      },
    );

  return program;
}
