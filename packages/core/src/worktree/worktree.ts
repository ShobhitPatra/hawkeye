import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"];
const GENERATED_PATHSPECS = [
  ".",
  ":(exclude,glob)**/pnpm-lock.yaml",
  ":(exclude,glob)**/package-lock.json",
  ":(exclude,glob)**/yarn.lock",
  ":(exclude,glob)**/bun.lockb",
  ":(exclude,glob)**/dist/**",
  ":(exclude,glob)**/*.min.js",
  ":(exclude,glob)**/*.min.css",
];

export type Worktree = { path: string; diff: string; remove(): Promise<void> };
export type CreateWorktreeInput = {
  cloneUrl: string;
  token?: string;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  directory: string;
};

const AUTHORIZATION_ENV = "HAWKEYE_GIT_AUTHORIZATION";

export function gitAuthorization(
  cloneUrl: string,
  token: string | undefined,
): { args: string[]; env: Record<string, string> } {
  if (token === undefined) return { args: [], env: {} };
  const url = URL.parse(cloneUrl);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
    return { args: [], env: {} };
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    args: ["--config-env", `http.${url.origin}/.extraheader=${AUTHORIZATION_ENV}`],
    env: { [AUTHORIZATION_ENV]: `Authorization: Basic ${basic}` },
  };
}

export async function createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
  const redact = (text: string) =>
    input.token === undefined
      ? text
      : text
          .replaceAll(input.token, "***")
          .replaceAll(Buffer.from(`x-access-token:${input.token}`).toString("base64"), "***");
  const auth = gitAuthorization(input.cloneUrl, input.token);
  const git = async (cwd: string | undefined, ...args: string[]) => {
    try {
      return (
        await run("git", args, {
          cwd,
          env: { ...process.env, ...auth.env, GIT_TERMINAL_PROMPT: "0" },
          maxBuffer: 64 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      const verb = args.find(
        (argument, index) =>
          argument !== "--config-env" && (index === 0 || args[index - 1] !== "--config-env"),
      );
      throw new Error(redact(`git ${verb} failed: ${(error as Error).message}`));
    }
  };

  await git(undefined, "init", "--quiet", input.directory);
  try {
    await git(input.directory, "remote", "add", "origin", input.cloneUrl);
    await git(
      input.directory,
      ...auth.args,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      `pull/${input.pullRequestNumber}/head`,
    );
    const fetchedHead = (await git(input.directory, "rev-parse", "FETCH_HEAD")).trim();
    await git(
      input.directory,
      ...auth.args,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      input.baseSha,
    );
    await git(input.directory, "remote", "remove", "origin");
    await git(input.directory, "checkout", "--quiet", "--detach", fetchedHead);
    if (fetchedHead !== input.headSha)
      throw new Error(`Head moved: expected ${input.headSha}, checkout is at ${fetchedHead}`);
    const diff = await git(
      input.directory,
      "diff",
      `${input.baseSha}..HEAD`,
      "--",
      ...GENERATED_PATHSPECS,
    );

    return {
      path: input.directory,
      diff,
      remove: () => rm(input.directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(input.directory, { recursive: true, force: true });
    throw error;
  }
}

export async function readRepositoryRules(
  worktreePath: string,
  maxBytes = 32_768,
): Promise<{ path: string; content: string }[]> {
  const rules: { path: string; content: string }[] = [];
  for (const file of RULE_FILES) {
    const content = await readFile(join(worktreePath, file), "utf8").catch(() => undefined);
    if (content !== undefined) rules.push({ path: file, content: content.slice(0, maxBytes) });
  }
  return rules;
}
