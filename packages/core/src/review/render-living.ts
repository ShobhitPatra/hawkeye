import type { Finding, ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import {
  footerLines,
  lensTableLines,
  oneLine,
  renderReviewSections,
  type ReviewComment,
  type RenderInput,
} from "./render.js";

export type LivingRoundSummary = {
  round: number;
  headSha: string;
  verdict: string;
  startedAt: string;
};
export type RenderLivingReviewInput = Pick<
  RenderInput,
  "result" | "headSha" | "commentable" | "repositoryUrl"
> & {
  previousIds: Set<string>;
  priorClaims?: Record<string, string>;
  rounds: LivingRoundSummary[];
};
export type RenderedLivingReview = { body: string; comments: ReviewComment[] };

function priorFindingLines(
  result: ReviewResult,
  priorClaims: Record<string, string> | undefined,
): string[] {
  if (result.priorFindings === undefined || result.priorFindings.length === 0) return [];
  const lines = ["", "### Prior findings", ""];
  for (const prior of result.priorFindings) {
    const claim = priorClaims?.[prior.id];
    lines.push(
      `- [${prior.id}] ${prior.status}${claim === undefined ? "" : ` · ${oneLine(claim)}`} · ${oneLine(prior.note)}`,
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

  lines.push("", "### Rounds", "", "| Round | Head | Verdict | Started |", "|---|---|---|---|");
  for (const round of input.rounds)
    lines.push(
      `| ${round.round} | \`${round.headSha.slice(0, 7)}\` | ${round.verdict.replaceAll("_", " ")} | ${round.startedAt} |`,
    );

  lines.push(...lensTableLines(input.result));
  lines.push(...footerLines(input.repositoryUrl));
  return { body: lines.join("\n"), comments };
}
