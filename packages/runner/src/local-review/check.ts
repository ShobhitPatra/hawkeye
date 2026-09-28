import { access } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessResult, HarnessSpec, ReviewTextStyle } from "@hawkeye/core";
import type { PreparedRound } from "./prepare.js";
import { showRound } from "./show.js";

export type ReviewRoundInput = {
  prepared: PreparedRound;
  harness: HarnessSpec;
  harnessName: string;
  maxTurns: number;
  wallClockMs: number;
  model?: string;
  onTurn(turns: number): void;
  log(line: string): void;
  warn(line: string): void;
  style?: Partial<ReviewTextStyle>;
  now?(): number;
};

function failure(name: string, outcome: HarnessResult, wallClockMs: number): string {
  if (outcome.status === "max-turns")
    return `${name} stopped at the turn limit after ${outcome.turns} turns; raise it with --max-turns.`;
  if (outcome.status === "timeout")
    return `${name} ran past ${Math.round(wallClockMs / 60_000)} minutes; raise it with --wall-clock-minutes.`;
  return `${name} ${outcome.error ?? `stopped (${outcome.status})`}.`;
}

export async function reviewRound(
  input: ReviewRoundInput,
): Promise<{ review: string; turns: number }> {
  const { prepared } = input;
  const now = input.now ?? Date.now;
  const startedAt = now();
  const run = (model: string | undefined) =>
    input.harness.run({
      cwd: prepared.checkoutPath,
      promptPath: join(prepared.directory, "prompt.md"),
      resultPath: prepared.resultPath,
      settingsPath: join(prepared.directory, "settings.json"),
      maxTurns: input.maxTurns,
      wallClockMs: Math.max(input.wallClockMs - (now() - startedAt), 0),
      ...(model === undefined ? {} : { model }),
      onEvent: (event) => {
        if (event.type === "turn") input.onTurn(event.turns);
      },
    });
  let outcome = await run(input.model);
  if (outcome.refusedModel !== undefined) {
    input.log(`model ${outcome.refusedModel} was refused; reviewing on the CLI default`);
    outcome = await run(undefined);
  }
  if (outcome.status !== "ok")
    throw new Error(failure(input.harnessName, outcome, input.wallClockMs));
  await access(prepared.resultPath).catch(() => {
    throw new Error(`${input.harnessName} finished without writing a review.`);
  });
  return {
    review: await showRound(prepared.directory, input.warn, input.style),
    turns: outcome.turns,
  };
}
