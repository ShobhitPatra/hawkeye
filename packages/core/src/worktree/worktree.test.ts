import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorktree, readRepositoryRules } from "./worktree.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  run("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });

let origin: string;
let baseSha: string;
let headSha: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "hawkeye-wt-"));
  const work = join(root, "work");
  origin = join(root, "origin.git");
  await mkdir(work);
  await git(work, "init", "-q", "-b", "main");
  await writeFile(join(work, "a.txt"), "one\n");
  await writeFile(join(work, "AGENTS.md"), "Rules.\n");
  await git(work, "add", ".");
  await git(work, "commit", "-q", "-m", "base");
  baseSha = (await git(work, "rev-parse", "HEAD")).stdout.trim();
  await git(work, "switch", "-q", "-c", "feat");
  await writeFile(join(work, "a.txt"), "one\ntwo\n");
  await git(work, "commit", "-q", "-am", "head");
  headSha = (await git(work, "rev-parse", "HEAD")).stdout.trim();
  await git(root, "clone", "-q", "--bare", work, origin);
  await git(root, "--git-dir", origin, "update-ref", "refs/pull/1/head", headSha);
});

describe("createWorktree", () => {
  it("clones the head, fetches the base and computes the diff", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    expect(await readFile(join(wt.path, "a.txt"), "utf8")).toBe("one\ntwo\n");
    expect(wt.diff).toContain("+two");
    await wt.remove();
    await expect(readFile(join(wt.path, "a.txt"))).rejects.toThrow();
  });
  it("fails when the head moved", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    await expect(
      createWorktree({
        cloneUrl: origin,
        pullRequestNumber: 1,
        headSha: "0".repeat(40),
        baseSha,
        directory,
      }),
    ).rejects.toThrow(/head/i);
  });
});

describe("readRepositoryRules", () => {
  it("reads rule files present at the root, truncated", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    expect(await readRepositoryRules(wt.path)).toEqual([
      { path: "AGENTS.md", content: "Rules.\n" },
    ]);
    expect((await readRepositoryRules(wt.path, 3))[0]!.content).toBe("Rul");
    await wt.remove();
  });
});
