import type { Finding, ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import type { RoundSummary } from "./render-text.js";
import { VERDICT_LABELS } from "./format.js";
import {
  footerLines,
  lensTableLines,
  oneLine,
  renderReviewSections,
  type ReviewComment,
  type RenderInput,
} from "./render.js";

export type RenderLivingReviewInput = Pick<
  RenderInput,
  "result" | "headSha" | "commentable" | "repositoryUrl"
> & {
  previousIds: Set<string>;
  priorClaims?: Record<string, string>;
  rounds: RoundSummary[];
};
export type RenderedLivingReview = { body: string; comments: ReviewComment[] };

function priorFindingLines(
  result: ReviewResult,
  priorClaims: Record<string, string> | undefined,
): string[] {
  if (result.priorFindings === undefined || result.priorFindings.length === 0) return [];
  const lines = ["", "#### Prior findings", ""];
  const currentClaims = new Map(
    result.findings.map(
      (finding) => [findingId(finding.path, finding.claim), finding.claim] as const,
    ),
  );
  for (const prior of result.priorFindings) {
    const claim = priorClaims?.[prior.id] ?? currentClaims.get(prior.id);
    const dropped = prior.status === "open" && !currentClaims.has(prior.id);
    lines.push(
      `- \`${prior.id}\` ${prior.status}${claim === undefined ? "" : ` · ${oneLine(claim)}`} · ${oneLine(prior.note)}${dropped ? " (not repeated in findings; the verdict ignores it)" : ""}`,
    );
  }
  return lines;
}

export function renderLivingReview(input: RenderLivingReviewInput): RenderedLivingReview {
  const { result, headSha } = input;
  const { lines, comments } = renderReviewSections({
    result,
    headSha,
    commentable: input.commentable,
    commentWorthy: (finding: Finding) =>
      !input.previousIds.has(findingId(finding.path, finding.claim)),
  });

  lines.push(...priorFindingLines(result, input.priorClaims));

  lines.push(
    "",
    "<details>",
    "<summary>Rounds</summary>",
    "",
    "| Round | Head | Verdict | Started |",
    "|---|---|---|---|",
  );
  for (const round of input.rounds)
    lines.push(
      `| ${round.round} | \`${round.headSha.slice(0, 7)}\` | ${roundVerdict(round.verdict)} | ${round.startedAt} |`,
    );
  lines.push("", "</details>");

  lines.push(...lensTableLines(input.result));
  const current = input.rounds.find((round) => round.headSha === headSha);
  lines.push(
    ...footerLines(input.repositoryUrl, {
      ...(current ? { round: current.round } : {}),
      ...(current?.turns === undefined ? {} : { turns: current.turns }),
    }),
  );
  return { body: lines.join("\n"), comments };
}

function roundVerdict(verdict: RoundSummary["verdict"]): string {
  if (verdict === "pending") return "Pending";
  if (verdict === "invalid") return "Invalid";
  return VERDICT_LABELS[verdict];
}
