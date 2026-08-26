import { dirname, join } from "node:path";
import { renderReviewText, type RoundSummary } from "@hawkeye/core";
import { listRounds, readRound, readRoundMeta, readRoundResult } from "./rounds.js";

export async function showRound(
  directory: string,
  warn: (line: string) => void = () => {},
): Promise<string> {
  const meta = await readRoundMeta(directory);
  const result = await readRoundResult(directory);
  if (result === undefined)
    throw new Error(`no review yet: the session has not written ${join(directory, "result.json")}`);
  const pullRequestDir = dirname(directory);
  const rounds: RoundSummary[] = [];
  for (const name of await listRounds(pullRequestDir)) {
    const roundDir = join(pullRequestDir, name);
    const round = await readRound(roundDir).catch((error: Error) => {
      warn(`skipping ${roundDir}: ${error.message}`);
      return undefined;
    });
    if (round === undefined) continue;
    rounds.push({
      round: round.meta.round,
      headSha: round.meta.headSha,
      verdict: round.result?.verdict ?? "pending",
      startedAt: round.meta.startedAt,
    });
  }
  return renderReviewText({ result, meta, rounds });
}
