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
  createCodexHarness,
  createGitHubClient,
  createWorktree,
  HAWKEYE_REPOSITORY_URL,
  parsePullRequestReference,
  readRepositoryRules,
  renderReviewOutcomeLine,
  renderReviewSummary,
  runReview,
} from "@hawkeye/core";
import {
  alreadyReviewedLines,
  connectedLine,
  connectedLines,
  reviewFailedLine,
  runnerStoppedLine,
} from "./cli-text.js";
import { expandHome, loadConfig } from "./config.js";
import { describePreparedRound, prepareRound } from "./local-review/prepare.js";
import { dismissFinding, withdrawDismissal } from "./local-review/rounds.js";
import { showRound, summarizeRound } from "./local-review/show.js";
import { resolveGitHubToken } from "./local-review/token.js";
import { reviewProgress } from "./review-progress.js";
import { createRunDirectory } from "./run-directory.js";
import { runnerConsole } from "./runner/console.js";
import { type ProgressLine, shortenHome, type TerminalStyle } from "./terminal.js";
import { createControlPlaneClient } from "./runner/client.js";
import { deviceLogin } from "./runner/device-login.js";
import {
  assertControlPlaneUrl,
  HOSTED_CONTROL_PLANE_URL,
  loadRunnerConfig,
  resolveConnection,
  type RunnerConfig,
  writeRunnerConfig,
} from "./runner/config.js";
import { runRunnerLoop, watchClock } from "./runner/loop.js";

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
  style?: TerminalStyle;
  stderrStyle?: TerminalStyle;
  progress?: ProgressLine;
  interactive?: boolean;
  openBrowser?(url: string): Promise<boolean>;
}): Command {
  const readRunnerConfig = () =>
    loadRunnerConfig({
      env: process.env,
      configPath: RUNNER_CONFIG_PATH,
      readFile: (p) => readFile(p, "utf8"),
    });
  const connect = async (input: {
    url: string;
    name: string;
    lead?: string;
  }): Promise<RunnerConfig> => {
    assertControlPlaneUrl(input.url);
    const token = await deviceLogin({
      baseUrl: input.url,
      runnerName: input.name,
      fetch,
      log: io.stderr,
      ...(io.stderrStyle === undefined ? {} : { emphasize: io.stderrStyle.verdict }),
      ...(io.openBrowser === undefined ? {} : { openBrowser: io.openBrowser }),
      ...(input.lead === undefined ? {} : { lead: input.lead }),
    });
    const config = { controlPlaneUrl: input.url, token };
    await writeRunnerConfig(RUNNER_CONFIG_PATH, config);
    return config;
  };

  const program = new Command("hawkeye")
    .enablePositionalOptions()
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
        const startedAt = Date.now();
        let maxTurns: number;
        let wallClockMinutes: number;
        let reference: ReturnType<typeof parsePullRequestReference>;
        try {
          if (options.full && !options.dryRun)
            throw new Error(
              "--full applies only with --dry-run; a posted review is read on GitHub",
            );
          maxTurns = positiveInteger("--max-turns", options.maxTurns);
          wallClockMinutes = positiveInteger("--wall-clock-minutes", options.wallClockMinutes);
          reference = parsePullRequestReference(pullRequest);
        } catch (error) {
          io.stderr((error as Error).message);
          process.exitCode = 1;
          return;
        }
        const progress = reviewProgress({
          progress: io.progress ?? { update: () => {}, clear: () => {} },
          stderr: io.stderr,
          subject: `${reference.owner}/${reference.repo}#${reference.number}`,
        });
        let log = progress.log;
        try {
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
          const runLogPath = join(directory, "log.txt");
          log = (line: string) => {
            progress.log(line);
            appendFileSync(runLogPath, `${line}\n`);
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
              onTurn: progress.turn,
            },
          );
          progress.finish();

          if (outcome.kind === "already-reviewed")
            for (const line of alreadyReviewedLines(reference, outcome.headSha)) io.stdout(line);
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
          if (outcome.kind === "posted") {
            io.stdout(
              renderReviewOutcomeLine({
                result: outcome.result,
                turns: outcome.turns,
                durationMs: Date.now() - startedAt,
                ...(io.style === undefined ? {} : { style: io.style }),
              }),
            );
            io.stdout(outcome.url);
          }
        } catch (error) {
          progress.finish();
          const message = (error as Error).message;
          progress.log(reviewFailedLine(message, io.stderrStyle?.must));
          if (runDirectory) {
            appendFileSync(join(runDirectory, "log.txt"), `${reviewFailedLine(message)}\n`);
            log(`The run is kept in ${shortenHome(runDirectory, homedir())}.`);
          }
          process.exitCode = 1;
        }
      },
    );

  const runner = program
    .command("runner")
    .description("review armed pull requests claimed from the control plane")
    .option("--once", "claim at most one job, then exit", false)
    .option(
      "--url <url>",
      `control plane to connect to when this machine is not connected yet (default: ${HOSTED_CONTROL_PLANE_URL})`,
    )
    .option("--name <name>", "runner name when this machine connects", hostname())
    .option(
      "--model <name>",
      "model passed to the claude CLI (else its default); a Codex job uses Codex's own default",
    )
    .option(
      "--contract <path>",
      "review contract that replaces the built-in lens and finding rules",
    )
    .action(
      async (options: {
        once: boolean;
        url?: string;
        name: string;
        contract?: string;
        model?: string;
      }) => {
        try {
          const connection = resolveConnection({
            saved: await readRunnerConfig(),
            url: options.url,
            interactive: io.interactive === true,
          });
          let config: RunnerConfig;
          if ("connected" in connection) config = connection.connected;
          else {
            config = await connect({
              url: connection.connectTo,
              name: options.name,
              lead: "Not connected.",
            });
            io.stderr(
              connectedLine({
                runnerName: options.name,
                configPath: RUNNER_CONFIG_PATH,
                home: homedir(),
              }),
            );
          }
          const contract = await loadContractOverride({
            ...(options.contract === undefined ? {} : { explicitPath: options.contract }),
            env: process.env,
            home: homedir(),
            defaultPath: DEFAULT_CONTRACT_PATH,
            readFile: (p) => readFile(p, "utf8"),
          });
          const terminal = runnerConsole({
            stderr: io.stderr,
            appendFile: (path, line) => appendFileSync(path, line),
            home: homedir(),
            ...(io.stderrStyle === undefined ? {} : { style: io.stderrStyle }),
          });
          if (contract) terminal.report({ state: "contract", detail: contract.path });
          const stop = new AbortController();
          const onSignal = (signal: NodeJS.Signals) => {
            terminal.report({
              state: "stopping",
              detail: `${signal} received; finishing the current job`,
            });
            stop.abort();
          };
          process.once("SIGINT", onSignal);
          process.once("SIGTERM", onSignal);
          terminal.report({ state: "polling", detail: config.controlPlaneUrl });
          const stopClock = watchClock(terminal.report);
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
                harnesses: { codex: createCodexHarness() },
                createWorktree,
                readRepositoryRules,
                createRunDirectory: (reference) =>
                  createRunDirectory({ root: RUNS_ROOT, reference, now: new Date() }),
                fetch,
                report: terminal.report,
                log: terminal.log,
                ...(contract ? { contractOverride: contract.content } : {}),
                signal: stop.signal,
              },
              { once: options.once },
            );
          } finally {
            stopClock();
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
          }
        } catch (error) {
          io.stderr(runnerStoppedLine(error));
          process.exitCode = 1;
        }
      },
    );

  runner
    .command("login")
    .description("connect this machine: approve a code on /connect, or pass a token directly")
    .option(
      "--url <url>",
      `control plane URL (default: the one this machine uses, else ${HOSTED_CONTROL_PLANE_URL})`,
    )
    .option("--token <token>", "runner token created on /runners; omit for the device flow")
    .option("--name <name>", "runner name for the device flow (ignored with --token)", hostname())
    .action(async (options: { url?: string; token?: string; name: string }) => {
      try {
        const url = options.url ?? (await readRunnerConfig()).controlPlaneUrl;
        if (options.token === undefined) await connect({ url, name: options.name });
        else
          await writeRunnerConfig(RUNNER_CONFIG_PATH, {
            controlPlaneUrl: url,
            token: options.token,
          });
        for (const line of connectedLines({
          runnerName: options.token === undefined ? options.name : undefined,
          configPath: RUNNER_CONFIG_PATH,
          home: homedir(),
        }))
          io.stdout(line);
      } catch (error) {
        io.stderr((error as Error).message);
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
          for (const line of describePreparedRound(prepared, homedir())) io.stdout(line);
        } catch (error) {
          io.stderr((error as Error).message);
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
        io.stderr((error as Error).message);
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
        io.stderr((error as Error).message);
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
        io.stderr((error as Error).message);
        process.exitCode = 1;
      }
    });

  return program;
}
