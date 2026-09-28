import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { HarnessResult, HarnessSpec } from "@hawkeye/core";
import { reviewRound } from "./check.js";

const LENSES = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const result = {
  verdict: "ship",
  summary: "- fine",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [
    {
      severity: "should_fix",
      claim: "Breaks on empty input",
      detail: "Guard it.",
      path: "a.ts",
      line: 4,
    },
  ],
};

async function prepared() {
  const directory = join(await mkdtemp(join(tmpdir(), "hawkeye-check-")), "round-1");
  await mkdir(join(directory, "checkout"), { recursive: true });
  await writeFile(
    join(directory, "meta.json"),
    JSON.stringify({
      round: 1,
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
      mergeBaseSha: "m".repeat(40),
      startedAt: "2026-09-28T10:00:00.000Z",
      pullRequest: { owner: "o", repo: "r", number: 7, title: "Add thing", author: "alice" },
    }),
  );
  return {
    meta: { round: 1 } as never,
    directory,
    resultPath: join(directory, "result.json"),
    checkoutPath: join(directory, "checkout"),
  };
}

function harness(outcomes: (HarnessResult & { write?: boolean })[]) {
  const calls: Parameters<HarnessSpec["run"]>[0][] = [];
  const spec: HarnessSpec = {
    name: "fake",
    async run(input) {
      calls.push(input);
      const next = outcomes.shift()!;
      input.onEvent({ type: "turn", turns: next.turns });
      if (next.write) await writeFile(input.resultPath, JSON.stringify(result));
      return next;
    },
  };
  return { spec, calls };
}

function checkInput(round: Awaited<ReturnType<typeof prepared>>, spec: HarnessSpec, extra = {}) {
  const turns: number[] = [];
  const logged: string[] = [];
  return {
    turns,
    logged,
    run: {
      prepared: round,
      harness: spec,
      harnessName: "claude",
      maxTurns: 40,
      wallClockMs: 15 * 60_000,
      onTurn: (n: number) => turns.push(n),
      log: (line: string) => logged.push(line),
      warn: () => {},
      ...extra,
    },
  };
}

describe("reviewRound", () => {
  it("runs the harness on the round and returns the whole review as text", async () => {
    const round = await prepared();
    const { spec, calls } = harness([{ status: "ok", turns: 9, write: true }]);
    const { run, turns } = checkInput(round, spec, { model: "opus" });
    const { review: text, turns: counted } = await reviewRound(run);
    expect(counted).toBe(9);
    expect(text.startsWith("Changes needed\n\n- fine\n\nShould fix\n")).toBe(true);
    expect(text).toContain("Breaks on empty input");
    expect(turns).toEqual([9]);
    expect(calls[0]).toMatchObject({
      cwd: round.checkoutPath,
      promptPath: join(round.directory, "prompt.md"),
      resultPath: round.resultPath,
      settingsPath: join(round.directory, "settings.json"),
      maxTurns: 40,
      model: "opus",
    });
  });
  it("reviews again on the CLI default when the model is refused", async () => {
    const round = await prepared();
    const { spec, calls } = harness([
      { status: "error", turns: 0, refusedModel: "opus-9" },
      { status: "ok", turns: 4, write: true },
    ]);
    const { run, logged } = checkInput(round, spec, { model: "opus-9" });
    await reviewRound(run);
    expect(calls[1]?.model).toBeUndefined();
    expect(logged).toEqual(["model opus-9 was refused; reviewing on the CLI default"]);
  });
  it("says why a run stopped and what to raise", async () => {
    for (const [outcome, message] of [
      [
        { status: "max-turns", turns: 40 },
        "claude stopped at the turn limit after 40 turns; raise it with --max-turns.",
      ],
      [
        { status: "timeout", turns: 12 },
        "claude ran past 15 minutes; raise it with --wall-clock-minutes.",
      ],
      [
        { status: "error", turns: 2, error: "exited 1 after 2 turns (not logged in)" },
        "claude exited 1 after 2 turns (not logged in).",
      ],
    ] as const) {
      const round = await prepared();
      const { spec } = harness([outcome]);
      await expect(reviewRound(checkInput(round, spec).run)).rejects.toThrow(message);
    }
  });
  it("fails when the harness finishes without writing a review", async () => {
    const round = await prepared();
    const { spec } = harness([{ status: "ok", turns: 3 }]);
    await expect(reviewRound(checkInput(round, spec).run)).rejects.toThrow(
      "claude finished without writing a review.",
    );
  });
});
