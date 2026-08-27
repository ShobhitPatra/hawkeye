import { dirname, join } from "node:path";
import { findingId, renderReviewText, type RoundSummary } from "@hawkeye/core";
import { listRounds, readRoundMeta, readRoundResult } from "./rounds.js";

export async function showRound(
  directory: string,
  warn: (line: string) => void = () => {},
): Promise<string> {
  const meta = await readRoundMeta(directory);
  const result = await readRoundResult(directory);
  if (result === undefined)
    throw new Error(`no review yet: the session has not written ${join(directory, "result.json")}`);
  const priorClaims: Record<string, string> = {};
  if (meta.previousRound !== undefined) {
    const reported = new Set((result.priorFindings ?? []).map((prior) => prior.id));
    const previous = await readRoundResult(
      join(dirname(directory), `round-${meta.previousRound}`),
    ).catch(() => undefined);
    for (const finding of previous?.findings ?? [])
      priorClaims[findingId(finding.path, finding.claim)] = finding.claim;
    const missing = (previous?.findings ?? [])
      .map((finding) => findingId(finding.path, finding.claim))
      .filter((id) => !reported.has(id));
    if (result.priorFindings === undefined)
      warn(`round ${meta.round} follows round ${meta.previousRound} but reports no priorFindings`);
    else if (missing.length > 0)
      warn(
        `round ${meta.round} does not report prior finding${missing.length === 1 ? "" : "s"} ${missing.join(", ")} from round ${meta.previousRound}`,
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
  const pullRequestDir = dirname(directory);
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
  return renderReviewText({ result, meta, rounds, priorClaims });
}
