import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const RULE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"];

export type Worktree = { path: string; diff: string; remove(): Promise<void> };
export type CreateWorktreeInput = {
  cloneUrl: string;
  token?: string;
  pullRequestNumber: number;
  headSha: string;
  baseSha: string;
  directory: string;
};

function authenticated(cloneUrl: string, token: string | undefined): string {
  if (token === undefined) return cloneUrl;
  const url = URL.parse(cloneUrl);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) return cloneUrl;
  url.username = "x-access-token";
  url.password = token;
  return url.toString();
}

export async function createWorktree(input: CreateWorktreeInput): Promise<Worktree> {
  const redact = (text: string) =>
    input.token === undefined ? text : text.replaceAll(input.token, "***");
  const git = async (cwd: string | undefined, ...args: string[]) => {
    try {
      return (
        await run("git", args, {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          maxBuffer: 64 * 1024 * 1024,
        })
      ).stdout;
    } catch (error) {
      throw new Error(redact(`git ${args[0]} failed: ${(error as Error).message}`));
    }
  };

  await git(undefined, "init", "--quiet", input.directory);
  await git(input.directory, "remote", "add", "origin", authenticated(input.cloneUrl, input.token));
  await git(
    input.directory,
    "fetch",
    "--quiet",
    "--depth",
    "1",
    "origin",
    `pull/${input.pullRequestNumber}/head`,
  );
  await git(input.directory, "checkout", "--quiet", "--detach", "FETCH_HEAD");
  const head = (await git(input.directory, "rev-parse", "HEAD")).trim();
  if (head !== input.headSha)
    throw new Error(`Head moved: expected ${input.headSha}, checkout is at ${head}`);
  await git(input.directory, "fetch", "--quiet", "--depth", "1", "origin", input.baseSha);
  await git(input.directory, "remote", "remove", "origin");
  const diff = await git(input.directory, "diff", `${input.baseSha}..HEAD`);

  return {
    path: input.directory,
    diff,
    remove: () => rm(input.directory, { recursive: true, force: true }),
  };
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
