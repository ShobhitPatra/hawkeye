import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, stat } from "node:fs/promises";
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
  it("leaves no origin remote or token behind", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      token: "ghs_secrettoken",
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    expect(wt.diff).toContain("+two");
    const config = await readFile(join(directory, ".git", "config"), "utf8");
    expect(config).not.toContain("x-access-token");
    expect(config).not.toContain("ghs_secrettoken");
    expect(config).not.toMatch(/\[remote "origin"\]/);
    expect((await git(directory, "remote")).stdout.trim()).toBe("");
    await wt.remove();
  });
  it("diffs against the merge base when the base branch advanced", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-wt-"));
    const work = join(root, "work");
    const advanced = join(root, "origin.git");
    await mkdir(work);
    await git(work, "init", "-q", "-b", "main");
    await writeFile(join(work, "a.txt"), "one\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "base");
    const forkPoint = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(work, "switch", "-q", "-c", "feat");
    await writeFile(join(work, "a.txt"), "one\ntwo\n");
    await git(work, "commit", "-q", "-am", "head");
    const featSha = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(work, "switch", "-q", "main");
    await writeFile(join(work, "b.txt"), "main only\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "advance");
    await git(root, "clone", "-q", "--bare", work, advanced);
    await git(root, "--git-dir", advanced, "update-ref", "refs/pull/1/head", featSha);

    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: advanced,
      pullRequestNumber: 1,
      headSha: featSha,
      baseSha: forkPoint,
      directory,
    });
    expect(wt.diff).toContain("+two");
    expect(wt.diff).not.toContain("b.txt");
    expect(wt.diff).not.toContain("-main only");
    await wt.remove();
  });
  it("fails when the head moved and removes the checkout", async () => {
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
    await expect(stat(directory)).rejects.toThrow();
  });
  it("removes the checkout when a fetch fails", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    await expect(
      createWorktree({
        cloneUrl: origin,
        pullRequestNumber: 99,
        headSha,
        baseSha,
        directory,
      }),
    ).rejects.toThrow(/fetch/);
    await expect(stat(directory)).rejects.toThrow();
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
