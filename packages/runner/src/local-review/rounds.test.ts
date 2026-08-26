import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findingId } from "@hawkeye/core";
import {
  createRound,
  dismissFinding,
  latestCompletedRound,
  listRounds,
  pruneOlderCheckouts,
  pullRequestDirectory,
  collectDismissals,
  readDismissals,
  readRound,
} from "./rounds.js";

const LENSES = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const metaFor = (round: number) => ({
  round,
  headSha: String(round).repeat(40),
  baseSha: "b".repeat(40),
  mergeBaseSha: "m".repeat(40),
  startedAt: "2026-08-26T10:00:00.000Z",
  pullRequest: { owner: "o", repo: "r", number: 7, title: "Add thing", author: "alice" },
});
const resultWith = (claim: string) => ({
  verdict: "ship",
  summary: "- fine",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [{ path: "src/a.ts", severity: "optional", claim, detail: "small" }],
});
async function roundDir(pullRequestDir: string, round: number, result?: unknown): Promise<string> {
  const directory = join(pullRequestDir, `round-${round}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "meta.json"), JSON.stringify(metaFor(round)));
  if (result !== undefined) await writeFile(join(directory, "result.json"), JSON.stringify(result));
  return directory;
}

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
  it("numbers rounds from one and prunes older checkouts on request", async () => {
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
    expect(await exists(join(first.directory, "checkout"))).toBe(true);
    await pruneOlderCheckouts(pullRequestDir, 2);
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

  it("reads a round with or without its result", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const withResult = await roundDir(root, 1, resultWith("Nit"));
    const pending = await roundDir(root, 2);
    expect((await readRound(withResult)).result?.verdict).toBe("mergeable");
    expect(await readRound(pending)).toEqual({ directory: pending, meta: metaFor(2) });
  });
  it("picks the highest round with a parsed result and warns about a broken one", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    expect(await latestCompletedRound(root)).toBeUndefined();
    await roundDir(root, 1, resultWith("First"));
    await roundDir(root, 2, resultWith("Second"));
    await roundDir(root, 3);
    const broken = await roundDir(root, 4, { verdict: "ship" });
    await writeFile(join(root, "round-3", "result.json"), "not json");
    const warnings: string[] = [];
    const latest = await latestCompletedRound(root, (line) => warnings.push(line));
    expect(latest?.meta.round).toBe(2);
    expect(latest?.result.findings[0]?.claim).toBe("Second");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(`skipping ${broken}: Invalid review result`);
    expect(warnings[1]).toContain(`skipping ${join(root, "round-3")}`);
  });
  it("records a dismissal for a finding of the round and rejects unknown ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const directory = await roundDir(root, 1, resultWith("Nit"));
    const id = findingId("src/a.ts", "Nit");
    expect(await readDismissals(directory)).toEqual({});
    await dismissFinding(directory, id, "by design");
    expect(await readDismissals(directory)).toEqual({ [id]: "by design" });
    await dismissFinding(directory, id, "still by design");
    expect(JSON.parse(await readFile(join(directory, "dismissed.json"), "utf8"))).toEqual({
      [id]: "still by design",
    });
    await expect(dismissFinding(directory, "000000000000", "no")).rejects.toThrow(
      `no finding 000000000000 in ${join(directory, "result.json")}`,
    );
    await expect(dismissFinding(directory, id, " ")).rejects.toThrow("a dismissal needs a reason");
    const pending = await roundDir(root, 2);
    await expect(dismissFinding(pending, id, "no")).rejects.toThrow(`no review yet in ${pending}`);
  });
  it("collects dismissals from every earlier round and skips a malformed file", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-reviews-"));
    const first = await roundDir(root, 1, resultWith("Nit"));
    const second = await roundDir(root, 2, resultWith("Other"));
    const third = await roundDir(root, 3, resultWith("Third"));
    await dismissFinding(first, findingId("src/a.ts", "Nit"), "by design");
    await writeFile(join(second, "dismissed.json"), JSON.stringify({ x: 7 }));
    await dismissFinding(third, findingId("src/a.ts", "Third"), "later");
    const warnings: string[] = [];
    expect(await collectDismissals(root, 3, (line) => warnings.push(line))).toEqual({
      [findingId("src/a.ts", "Nit")]: "by design",
    });
    expect(warnings).toEqual([
      `skipping ${join(second, "dismissed.json")}: ${join(second, "dismissed.json")} is not a dismissal file: x needs a reason`,
    ]);
    await expect(readDismissals(second)).rejects.toThrow("is not a dismissal file");
  });
});
