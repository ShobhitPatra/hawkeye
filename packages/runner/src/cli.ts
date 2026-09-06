import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import {
  createClaudeCodeHarness,
  createGitHubClient,
  createWorktree,
  HAWKEYE_REPOSITORY_URL,
  parsePullRequestReference,
  readRepositoryRules,
  renderReviewSummary,
  type ReviewTextStyle,
  runReview,
} from "@hawkeye/core";
import { expandHome, loadConfig } from "./config.js";
import { describePreparedRound, prepareRound } from "./local-review/prepare.js";
import { dismissFinding, withdrawDismissal } from "./local-review/rounds.js";
import { showRound, summarizeRound } from "./local-review/show.js";
import { resolveGitHubToken } from "./local-review/token.js";
import { createRunDirectory } from "./run-directory.js";
import { createControlPlaneClient } from "./runner/client.js";
import { deviceLogin } from "./runner/device-login.js";
import { assertControlPlaneUrl, loadRunnerConfig, writeRunnerConfig } from "./runner/config.js";
import { runRunnerLoop } from "./runner/loop.js";

const CONFIG_PATH = join(homedir(), ".config", "hawkeye", "config.json");
const RUNNER_CONFIG_PATH = join(homedir(), ".config", "hawkeye", "runner.json");
const DEFAULT_CONTRACT_PATH = join(homedir(), ".config", "hawkeye", "contract.md");
const RUNS_ROOT = join(homedir(), ".cache", "hawkeye", "runs");
const REVIEWS_ROOT = join(homedir(), ".cache", "hawkeye", "reviews");

const execFileAsync = promisify(execFile);
const exec = async (command: string, args: string[]) => {
  try {
    const { stdout } = await execFileAsync(command, args);
    return { exitCode: 0, stdout };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : null,
      stdout: failure.stdout ?? "",
    };
  }
};

function positiveInteger(flag: string, value: string): number {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`${flag} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

export async function loadContractOverride(input: {
  explicitPath?: string;
  env: Record<string, string | undefined>;
  home: string;
  defaultPath: string;
  readFile(path: string): Promise<string>;
}): Promise<{ path: string; content: string } | undefined> {
  const requested = input.explicitPath ?? input.env.HAWKEYE_CONTRACT_PATH;
  const path = requested === undefined ? input.defaultPath : expandHome(requested, input.home);
  try {
    return { path, content: await input.readFile(path) };
  } catch (error) {
    if (requested === undefined && (error as NodeJS.ErrnoException).code === "ENOENT")
      return undefined;
    throw new Error(`cannot read contract at ${path}`, { cause: error });
  }
}

export function createProgram(io: {
  stdout(line: string): void;
  stderr(line: string): void;
  style?: ReviewTextStyle;
}): Command {
  const program = new Command("hawkeye")
    .version(packageJson.version)
    .description("Personal code reviewer on your own Claude plan");

  program
    .command("review")
    .argument("<pull-request>", "https://github.com/owner/repo/pull/N or owner/repo#N")
    .option("--dry-run", "render the review and print it without posting", false)
    .option("--full", "with --dry-run, print the whole review as it would be posted", false)
    .option("--force", "review even if this head sha was already reviewed", false)
    .option("--max-turns <n>", "assistant turn limit", "40")
    .option("--wall-clock-minutes <n>", "wall clock limit in minutes", "15")
    .option("--model <name>", "model passed to the claude CLI (else its default)")
    .option(
      "--contract <path>",
      "review contract that replaces the built-in lens and finding rules",
    )
    .action(
      async (
        pullRequest: string,
        options: {
          dryRun: boolean;
          full: boolean;
          force: boolean;
          maxTurns: string;
          wallClockMinutes: string;
          contract?: string;
          model?: string;
        },
      ) => {
        let runDirectory: string | undefined;
        let log = io.stderr;
        try {
          if (options.full && !options.dryRun)
            throw new Error(
              "--full applies only with --dry-run; a posted review is read on GitHub",
            );
          const maxTurns = positiveInteger("--max-turns", options.maxTurns);
          const wallClockMinutes = positiveInteger(
            "--wall-clock-minutes",
            options.wallClockMinutes,
          );
          const reference = parsePullRequestReference(pullRequest);
          const config = await loadConfig({
            env: process.env,
            home: homedir(),
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

          const contract = await loadContractOverride({
            ...(options.contract === undefined ? {} : { explicitPath: options.contract }),
            env: process.env,
            home: homedir(),
            defaultPath: DEFAULT_CONTRACT_PATH,
            readFile: (p) => readFile(p, "utf8"),
          });
          if (contract) log(`using contract override: ${contract.path}`);

          const outcome = await runReview(
            {
              reference,
              botLogin: `${config.appSlug}[bot]`,
              repositoryUrl: HAWKEYE_REPOSITORY_URL,
              runDirectory: directory,
              maxTurns,
              wallClockMs: wallClockMinutes * 60_000,
              dryRun: options.dryRun,
              force: options.force,
              ...(contract ? { contractOverride: contract.content } : {}),
            },
            {
              github: createGitHubClient({ appId: config.appId, privateKeyPem, fetch }),
              harness: createClaudeCodeHarness(
                options.model === undefined ? {} : { model: options.model },
              ),
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
              options.full
                ? `${outcome.review.body}\n\n${outcome.review.comments.map((c) => `--- ${c.path}:${c.line}\n${c.body}`).join("\n\n")}`
                : `${renderReviewSummary({
                    result: outcome.result,
                    turns: outcome.turns,
                    resultPath: outcome.reviewPath,
                    ...(io.style === undefined ? {} : { style: io.style }),
                  })}\nNot posted: dry run.`,
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

  const runner = program
    .command("runner")
    .description("review armed pull requests claimed from the control plane")
    .option("--once", "claim at most one job, then exit", false)
    .option("--model <name>", "model passed to the claude CLI (else its default)")
    .option(
      "--contract <path>",
      "review contract that replaces the built-in lens and finding rules",
    )
    .action(async (options: { once: boolean; contract?: string; model?: string }) => {
      try {
        const config = await loadRunnerConfig({
          env: process.env,
          configPath: RUNNER_CONFIG_PATH,
          readFile: (p) => readFile(p, "utf8"),
        });
        const contract = await loadContractOverride({
          ...(options.contract === undefined ? {} : { explicitPath: options.contract }),
          env: process.env,
          home: homedir(),
          defaultPath: DEFAULT_CONTRACT_PATH,
          readFile: (p) => readFile(p, "utf8"),
        });
        if (contract) io.stderr(`using contract override: ${contract.path}`);
        const stop = new AbortController();
        const onSignal = (signal: NodeJS.Signals) => {
          io.stderr(`${signal} received; finishing the current job`);
          stop.abort();
        };
        process.once("SIGINT", onSignal);
        process.once("SIGTERM", onSignal);
        io.stderr(`polling ${config.controlPlaneUrl}`);
        try {
          await runRunnerLoop(
            {
              client: createControlPlaneClient({
                baseUrl: config.controlPlaneUrl,
                token: config.token,
                fetch,
              }),
              harness: createClaudeCodeHarness(
                options.model === undefined ? {} : { model: options.model },
              ),
              createWorktree,
              readRepositoryRules,
              createRunDirectory: (reference) =>
                createRunDirectory({ root: RUNS_ROOT, reference, now: new Date() }),
              fetch,
              log: io.stderr,
              ...(contract ? { contractOverride: contract.content } : {}),
              signal: stop.signal,
            },
            { once: options.once },
          );
        } finally {
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
        }
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  runner
    .command("login")
    .description("connect this machine: approve a code on /connect, or pass a token directly")
    .requiredOption("--url <url>", "control plane URL, e.g. https://hawkeye.example")
    .option("--token <token>", "runner token created on /runners; omit for the device flow")
    .option("--name <name>", "runner name for the device flow (ignored with --token)", hostname())
    .action(async (options: { url: string; token?: string; name: string }) => {
      try {
        assertControlPlaneUrl(options.url);
        const token =
          options.token ??
          (await deviceLogin({
            baseUrl: options.url,
            runnerName: options.name,
            fetch,
            log: io.stderr,
          }));
        await writeRunnerConfig(RUNNER_CONFIG_PATH, { controlPlaneUrl: options.url, token });
        if (options.token === undefined) io.stdout(`runner ${options.name} connected`);
        io.stdout(`saved ${RUNNER_CONFIG_PATH}`);
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("prepare")
    .description("check out a pull request and write the review prompt for any agent session")
    .argument("<pull-request>", "https://github.com/owner/repo/pull/N or owner/repo#N")
    .option("--github-token <token>", "GitHub token; else GITHUB_TOKEN, else gh auth token")
    .option(
      "--contract <path>",
      "review contract that replaces the built-in lens and finding rules",
    )
    .option("--root <dir>", "where review rounds are kept", REVIEWS_ROOT)
    .action(
      async (
        pullRequest: string,
        options: { githubToken?: string; contract?: string; root: string },
      ) => {
        try {
          const reference = parsePullRequestReference(pullRequest);
          const token = await resolveGitHubToken({
            ...(options.githubToken === undefined ? {} : { option: options.githubToken }),
            env: process.env,
            exec,
          });
          const contract = await loadContractOverride({
            ...(options.contract === undefined ? {} : { explicitPath: options.contract }),
            env: process.env,
            home: homedir(),
            defaultPath: DEFAULT_CONTRACT_PATH,
            readFile: (p) => readFile(p, "utf8"),
          });
          if (contract) io.stderr(`using contract override: ${contract.path}`);
          const prepared = await prepareRound(
            {
              reference,
              token,
              root: expandHome(options.root, homedir()),
              ...(contract ? { contractOverride: contract.content } : {}),
            },
            {
              fetch,
              createWorktree,
              readRepositoryRules,
              now: () => new Date(),
              warn: (line) => io.stderr(`warning: ${line}`),
            },
          );
          for (const line of describePreparedRound(prepared)) io.stdout(line);
        } catch (error) {
          io.stderr(`error: ${(error as Error).message}`);
          process.exitCode = 1;
        }
      },
    );

  program
    .command("show")
    .description("print the verdict and findings of a prepared round")
    .argument("<round-dir>", "round directory printed by prepare")
    .option("--full", "print the whole review: details, prior findings, lenses and rounds", false)
    .action(async (roundDirectory: string, options: { full: boolean }) => {
      try {
        const directory = expandHome(roundDirectory, homedir());
        const warn = (line: string) => io.stderr(`warning: ${line}`);
        io.stdout(
          options.full
            ? await showRound(directory, warn)
            : await summarizeRound(directory, warn, io.style),
        );
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("undismiss")
    .description("withdraw a dismissal so the finding is raised again")
    .argument("<round-dir>", "round directory printed by prepare")
    .argument("<finding-id>", "finding id shown by show")
    .action(async (roundDirectory: string, id: string) => {
      try {
        const withdrawn = await withdrawDismissal(expandHome(roundDirectory, homedir()), id);
        io.stdout(`withdrew the dismissal of ${id} in ${withdrawn.directory}`);
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  program
    .command("dismiss")
    .description("record why a finding of a round is not going to be acted on")
    .argument("<round-dir>", "round directory printed by prepare")
    .argument("<finding-id>", "finding id shown by show")
    .argument("<reason>", "why the finding does not apply; carried into the next round")
    .action(async (roundDirectory: string, id: string, reason: string) => {
      try {
        const dismissed = await dismissFinding(expandHome(roundDirectory, homedir()), id, reason);
        io.stdout(`dismissed ${id} in ${dismissed.directory}`);
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  return program;
}
