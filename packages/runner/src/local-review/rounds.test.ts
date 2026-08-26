import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRound, listRounds, pullRequestDirectory } from "./rounds.js";

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("rounds", () => {
  it("nests the pull request directory under owner/repo/number", () => {
    expect(pullRequestDirectory("/root", { owner: "o", repo: "r", number: 7 })).toBe(
      join("/root", "o", "r", "7"),
    );
  });
  it("numbers rounds from one and removes older checkouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const pullRequestDir = pullRequestDirectory(root, { owner: "o", repo: "r", number: 7 });
    expect(await listRounds(pullRequestDir)).toEqual([]);

    const first = await createRound(pullRequestDir);
    expect(first).toEqual({ round: 1, directory: join(pullRequestDir, "round-1") });
    await mkdir(join(first.directory, "checkout"));
    await writeFile(join(first.directory, "checkout", "a.txt"), "a");
    await writeFile(join(first.directory, "result.json"), "{}");
    await writeFile(join(pullRequestDir, "notes.txt"), "ignored");

    const second = await createRound(pullRequestDir);
    expect(second).toEqual({ round: 2, directory: join(pullRequestDir, "round-2") });
    expect(await exists(join(first.directory, "checkout"))).toBe(false);
    expect(await exists(join(first.directory, "result.json"))).toBe(true);
    expect(await listRounds(pullRequestDir)).toEqual(["round-1", "round-2"]);
  });

  it("numbers after the highest round, so a pruned round is never overwritten", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const pullRequestDir = pullRequestDirectory(root, { owner: "o", repo: "r", number: 7 });
    await mkdir(join(pullRequestDir, "round-3"), { recursive: true });
    await mkdir(join(pullRequestDir, "round-x"), { recursive: true });
    await writeFile(join(pullRequestDir, "round-3", "result.json"), "{}");

    const next = await createRound(pullRequestDir);
    expect(next).toEqual({ round: 4, directory: join(pullRequestDir, "round-4") });
    expect(await exists(join(pullRequestDir, "round-3", "result.json"))).toBe(true);
  });
});
