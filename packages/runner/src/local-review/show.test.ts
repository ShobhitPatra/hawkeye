import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showRound } from "./show.js";

const LENSES = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const meta = {
  round: 3,
  headSha: "c".repeat(40),
  baseSha: "b".repeat(40),
  mergeBaseSha: "m".repeat(40),
  startedAt: "2026-08-26T10:00:00.000Z",
  pullRequest: { owner: "o", repo: "r", number: 7, title: "Add thing", author: "alice" },
};

async function roundWith(result: unknown): Promise<string> {
  const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-pr-")), "round-3");
  await mkdir(directory);
  await writeFile(join(directory, "meta.json"), JSON.stringify(meta));
  await writeFile(join(directory, "result.json"), JSON.stringify(result));
  return directory;
}

describe("showRound", () => {
  it("renders a valid result as text with the derived verdict", async () => {
    const directory = await roundWith({
      verdict: "ship",
      summary: "- fine",
      lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
      findings: [{ severity: "optional", claim: "Nit", detail: "small" }],
    });
    const text = await showRound(directory);
    expect(text.startsWith("Verdict: MERGEABLE\n\n- fine\n\noptional:\n")).toBe(true);
    expect(
      text.endsWith("Rounds:\n- round 3 · ccccccc · mergeable · 2026-08-26T10:00:00.000Z"),
    ).toBe(true);
  });
  it("lists every round of the pull request, pending ones without a verdict", async () => {
    const directory = await roundWith({
      verdict: "ship",
      summary: "- fine",
      lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
      findings: [],
      priorFindings: [{ id: "id1", status: "addressed", note: "guarded now" }],
    });
    const pullRequestDir = join(directory, "..");
    await mkdir(join(pullRequestDir, "round-1"));
    await writeFile(
      join(pullRequestDir, "round-1", "meta.json"),
      JSON.stringify({
        ...meta,
        round: 1,
        headSha: "1".repeat(40),
        startedAt: "2026-08-25T10:00:00.000Z",
      }),
    );
    await writeFile(
      join(pullRequestDir, "round-1", "result.json"),
      JSON.stringify({
        verdict: "ship",
        summary: "- bug",
        lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
        findings: [{ severity: "must_fix", claim: "Crash", detail: "boom" }],
      }),
    );
    await mkdir(join(pullRequestDir, "round-2"));
    await writeFile(
      join(pullRequestDir, "round-2", "meta.json"),
      JSON.stringify({ ...meta, round: 2, headSha: "2".repeat(40) }),
    );
    await mkdir(join(pullRequestDir, "round-0"));
    await writeFile(join(pullRequestDir, "round-0", "meta.json"), "{");
    await mkdir(join(pullRequestDir, "round-4"));
    await writeFile(
      join(pullRequestDir, "round-4", "meta.json"),
      JSON.stringify({ ...meta, round: 4, headSha: "4".repeat(40) }),
    );
    await writeFile(join(pullRequestDir, "round-4", "result.json"), JSON.stringify({ nope: 1 }));
    const warnings: string[] = [];
    const text = await showRound(directory, (line) => warnings.push(line));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${join(pullRequestDir, "round-4")}: Invalid review result`);
    expect(text).toContain("Prior findings:\n- [id1] addressed · guarded now");
    expect(
      text.endsWith(
        [
          "Rounds:",
          "- round 1 · 1111111 · blocked · 2026-08-25T10:00:00.000Z",
          "- round 2 · 2222222 · pending · 2026-08-26T10:00:00.000Z",
          "- round 3 · ccccccc · ship · 2026-08-26T10:00:00.000Z",
          "- round 4 · 4444444 · invalid · 2026-08-26T10:00:00.000Z",
        ].join("\n"),
      ),
    ).toBe(true);
  });
  it("throws the validation message for an invalid result", async () => {
    const directory = await roundWith({ verdict: "ship", summary: "", lenses: [], findings: [] });
    await expect(showRound(directory)).rejects.toThrow(/^Invalid review result: summary:/);
  });

  it("names the meta file when it is not a round meta", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hawkeye-round-"));
    await writeFile(join(directory, "meta.json"), JSON.stringify({ round: "3" }));
    await writeFile(join(directory, "result.json"), "{}");
    await expect(showRound(directory)).rejects.toThrow(
      `${join(directory, "meta.json")} is not a round meta file`,
    );
  });
  it("says the session has not written a result yet", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hawkeye-round-"));
    await writeFile(join(directory, "meta.json"), JSON.stringify(meta));
    await expect(showRound(directory)).rejects.toThrow(
      `no review yet: the session has not written ${join(directory, "result.json")}`,
    );
  });
  it("warns when an open prior finding is not repeated in the findings", async () => {
    const directory = await roundWith({
      verdict: "ship",
      summary: "- fine",
      lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
      findings: [],
      priorFindings: [{ id: "id1", status: "open", note: "still there" }],
    });
    const warnings: string[] = [];
    await showRound(directory, (line) => warnings.push(line));
    expect(warnings).toEqual([
      "prior finding id1 is reported open but not repeated in findings; the verdict ignores it",
    ]);
  });
});
