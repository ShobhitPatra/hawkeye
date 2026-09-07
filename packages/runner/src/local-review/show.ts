import { dirname, join } from "node:path";
import {
  findingId,
  renderReviewSummary,
  renderReviewText,
  type ReviewTextStyle,
  type RoundSummary,
} from "@hawkeye/core";
import { listRounds, priorFindingsBefore, readRoundMeta, readRoundResult } from "./rounds.js";

export async function showRound(
  directory: string,
  warn: (line: string) => void = () => {},
): Promise<string> {
  const { result, meta, priorClaims } = await loadRound(directory, warn);
  const rounds = await roundsOf(dirname(directory), warn);
  return renderReviewText({ result, meta, rounds, priorClaims });
}

export async function summarizeRound(
  directory: string,
  warn: (line: string) => void = () => {},
  style?: Partial<ReviewTextStyle>,
): Promise<string> {
  const { result, meta, priorClaims } = await loadRound(directory, warn);
  return renderReviewSummary({
    result,
    meta,
    priorClaims,
    resultPath: join(directory, "result.json"),
    ...(style === undefined ? {} : { style }),
  });
}

async function loadRound(directory: string, warn: (line: string) => void) {
  const meta = await readRoundMeta(directory);
  const result = await readRoundResult(directory);
  if (result === undefined)
    throw new Error(
      `No review yet. The session has not written ${join(directory, "result.json")}.`,
    );
  const priorClaims: Record<string, string> = {};
  if (meta.previousRound !== undefined) {
    const reported = new Set((result.priorFindings ?? []).map((prior) => prior.id));
    const previous = await readRoundResult(
      join(dirname(directory), `round-${meta.previousRound}`),
    ).catch(() => undefined);
    const expected = await priorFindingsBefore(
      dirname(directory),
      meta.round,
      previous?.findings ?? [],
      warn,
    );
    for (const prior of expected) priorClaims[prior.id] = prior.claim;
    const carried = meta.carriedFindings ?? expected.map((prior) => prior.id);
    const missing = carried.filter((id) => !reported.has(id));
    if (result.priorFindings === undefined)
      warn(`round ${meta.round} follows round ${meta.previousRound} but reports no priorFindings`);
    else if (missing.length > 0)
      warn(
        `round ${meta.round} does not report prior finding${missing.length === 1 ? "" : "s"} ${missing.join(", ")} carried from earlier rounds`,
      );
  }
  const repeated = new Set(
    result.findings.map((finding) => findingId(finding.path, finding.claim)),
  );
  for (const prior of result.priorFindings ?? [])
    if (prior.status === "open" && !repeated.has(prior.id))
      warn(
        `prior finding ${prior.id} is reported open but not repeated in findings; the verdict ignores it`,
      );
  return { result, meta, priorClaims };
}

async function roundsOf(
  pullRequestDir: string,
  warn: (line: string) => void,
): Promise<RoundSummary[]> {
  const rounds: RoundSummary[] = [];
  for (const name of await listRounds(pullRequestDir)) {
    const roundDir = join(pullRequestDir, name);
    const siblingMeta = await readRoundMeta(roundDir).catch((error: Error) => {
      warn(`skipping ${roundDir}: ${error.message}`);
      return undefined;
    });
    if (siblingMeta === undefined) continue;
    const verdict: RoundSummary["verdict"] = await readRoundResult(roundDir).then(
      (siblingResult): RoundSummary["verdict"] => siblingResult?.verdict ?? "pending",
      (error: Error): RoundSummary["verdict"] => {
        warn(`${roundDir}: ${error.message}`);
        return "invalid";
      },
    );
    rounds.push({
      round: siblingMeta.round,
      headSha: siblingMeta.headSha,
      verdict,
      startedAt: siblingMeta.startedAt,
    });
  }
  return rounds;
}
