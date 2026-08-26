import { mkdtemp, writeFile } from "node:fs/promises";
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
  const directory = await mkdtemp(join(tmpdir(), "hawkeye-round-"));
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
    expect(text.startsWith("Verdict: mergeable\n\n- fine\n\noptional:\n")).toBe(true);
    expect(text.endsWith("Round 3 · head ccccccc · mergeable")).toBe(true);
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
});
