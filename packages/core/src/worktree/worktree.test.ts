import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { createWorktree, gitAuthorization, readRepositoryRules } from "./worktree.js";

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
let previousHeadSha: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "hawkeye-wt-"));
  const work = join(root, "work");
  origin = join(root, "origin.git");
  await mkdir(work);
  await git(work, "init", "-q", "-b", "main");
  await writeFile(join(work, "a.txt"), "one\n");
  await writeFile(join(work, "AGENTS.md"), "Rules.\n");
  await writeFile(join(work, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  await git(work, "add", ".");
  await git(work, "commit", "-q", "-m", "base");
  baseSha = (await git(work, "rev-parse", "HEAD")).stdout.trim();
  await git(work, "switch", "-q", "-c", "feat");
  await writeFile(join(work, "a.txt"), "one\ntwo\n");
  await git(work, "commit", "-q", "-am", "previous head");
  previousHeadSha = (await git(work, "rev-parse", "HEAD")).stdout.trim();
  await writeFile(join(work, "c.txt"), "three\n");
  await writeFile(join(work, "pnpm-lock.yaml"), "lockfileVersion: 9\nregenerated: true\n");
  await git(work, "add", ".");
  await git(work, "commit", "-q", "-m", "head");
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
  it("excludes generated files from the diff", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    expect(wt.diff).toContain("+two");
    expect(wt.diff).not.toContain("pnpm-lock.yaml");
    await wt.remove();
  });
  it("computes the interdiff from the previous head when one is given", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
      previousHeadSha,
    });
    expect(wt.diff).toContain("+two");
    expect(wt.interdiff).toContain("+three");
    expect(wt.interdiff).not.toContain("+two");
    expect(wt.interdiff).not.toContain("pnpm-lock.yaml");
    await wt.remove();
  });
  it("returns an empty interdiff when the previous head is the head", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
      previousHeadSha: headSha,
    });
    expect(wt.interdiff).toBe("");
    await wt.remove();
  });
  it("omits the interdiff without a previous head", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    expect(wt.interdiff).toBeUndefined();
    await wt.remove();
  });
  it("omits the interdiff when the previous head is no longer on the server", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const wt = await createWorktree({
      cloneUrl: origin,
      pullRequestNumber: 1,
      headSha,
      baseSha,
      previousHeadSha: "f".repeat(40),
      directory,
    });
    expect(wt.interdiff).toBeUndefined();
    expect(wt.diff).toContain("+two");
    await wt.remove();
  });
  it("passes the credential through the environment, not argv or the config", async () => {
    expect(gitAuthorization("https://github.com/o/r.git", "ghs_secrettoken")).toEqual({
      args: ["--config-env", "http.https://github.com/.extraheader=HAWKEYE_GIT_AUTHORIZATION"],
      env: {
        HAWKEYE_GIT_AUTHORIZATION: `Authorization: Basic ${Buffer.from("x-access-token:ghs_secrettoken").toString("base64")}`,
      },
    });
    expect(gitAuthorization("/local/path", "ghs_secrettoken")).toEqual({ args: [], env: {} });
    expect(gitAuthorization("https://github.com/o/r.git", undefined)).toEqual({
      args: [],
      env: {},
    });

    const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-co-")), "checkout");
    const failing = createWorktree({
      cloneUrl: "https://127.0.0.1:9/o/r.git",
      token: "ghs_secrettoken",
      pullRequestNumber: 1,
      headSha,
      baseSha,
      directory,
    });
    await expect(failing).rejects.toThrow(/git fetch failed/);
    await expect(failing).rejects.not.toThrow(/ghs_secrettoken/);
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
  it("keeps upstream files merged from the base out of the interdiff", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-merge-"));
    const work = join(root, "work");
    const bare = join(root, "origin.git");
    await mkdir(work);
    await git(work, "init", "-q", "-b", "main");
    await writeFile(join(work, "a.txt"), "one\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "base");
    await git(work, "switch", "-q", "-c", "feat");
    await writeFile(join(work, "a.txt"), "one\ntwo\n");
    await git(work, "commit", "-q", "-am", "previous");
    const previous = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(work, "switch", "-q", "main");
    await writeFile(join(work, "upstream.txt"), "from main\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "upstream");
    const mainTip = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(work, "switch", "-q", "feat");
    await git(work, "merge", "-q", "--no-edit", "main");
    await writeFile(join(work, "a.txt"), "one\ntwo\nthree\n");
    await git(work, "commit", "-q", "-am", "head");
    const head = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(root, "clone", "-q", "--bare", work, bare);
    await git(root, "--git-dir", bare, "update-ref", "refs/pull/1/head", head);

    const directory = join(root, "checkout");
    const wt = await createWorktree({
      cloneUrl: bare,
      pullRequestNumber: 1,
      headSha: head,
      baseSha: mainTip,
      previousHeadSha: previous,
      directory,
    });
    expect(wt.diff).not.toContain("upstream.txt");
    expect(wt.interdiff).toContain("+three");
    expect(wt.interdiff).not.toContain("upstream.txt");
    await wt.remove();
  });
  it("keeps a file the author reverted, deleted or renamed since the previous round in the interdiff", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-revert-"));
    const work = join(root, "work");
    const bare = join(root, "origin.git");
    await mkdir(work);
    await git(work, "init", "-q", "-b", "main");
    await writeFile(join(work, "a.txt"), "one\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "base");
    const base = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(work, "switch", "-q", "-c", "feat");
    await writeFile(join(work, "a.txt"), "one\ntwo\n");
    await writeFile(join(work, "b.txt"), "temporary\n");
    await writeFile(join(work, "café.txt"), "accent\n");
    await writeFile(join(work, "old.txt"), "moving\n");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "previous");
    const previous = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await writeFile(join(work, "a.txt"), "one\n");
    await git(work, "rm", "-q", "b.txt");
    await writeFile(join(work, "café.txt"), "accent\nmore\n");
    await git(work, "mv", "old.txt", "new.txt");
    await git(work, "add", ".");
    await git(work, "commit", "-q", "-m", "head");
    const head = (await git(work, "rev-parse", "HEAD")).stdout.trim();
    await git(root, "clone", "-q", "--bare", work, bare);
    await git(root, "--git-dir", bare, "update-ref", "refs/pull/1/head", head);

    const directory = join(root, "checkout");
    const wt = await createWorktree({
      cloneUrl: bare,
      pullRequestNumber: 1,
      headSha: head,
      baseSha: base,
      previousHeadSha: previous,
      directory,
    });
    expect(wt.interdiff).toContain("-two");
    expect(wt.interdiff).toContain("-temporary");
    expect(wt.interdiff).toContain("+more");
    expect(wt.interdiff).toMatch(/rename from old\.txt|--- a\/old\.txt/);
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
