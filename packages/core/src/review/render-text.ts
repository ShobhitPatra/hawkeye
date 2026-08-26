import { type Finding, type ReviewResult, SEVERITIES, type Verdict } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { indentLines, SEVERITY_BADGE } from "./format.js";

export type RoundSummary = {
  round: number;
  headSha: string;
  verdict: Verdict | "pending";
  startedAt: string;
};
export type RenderTextInput = {
  result: ReviewResult;
  meta: { round: number; headSha: string };
  rounds?: RoundSummary[];
};

function headline(finding: Finding): string {
  const location =
    finding.path === undefined
      ? ""
      : ` (${finding.path}${finding.line === undefined ? "" : `:${finding.line}`})`;
  return `- [${findingId(finding.path, finding.claim)}] ${finding.claim.replace(/\r?\n/g, " ")}${location}`;
}

export function renderReviewText({ result, meta, rounds }: RenderTextInput): string {
  const verdict = result.verdict.replaceAll("_", " ");
  const lines = [`Verdict: ${verdict.toUpperCase()}`, "", result.summary];
  for (const severity of SEVERITIES) {
    const group = result.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push("", `${SEVERITY_BADGE[severity]}:`);
    for (const finding of group) {
      lines.push(headline(finding), ...indentLines(finding.detail, "  "));
      if (finding.rationale !== undefined)
        lines.push(`  why: ${indentLines(finding.rationale, "  ").join("\n").trimStart()}`);
      if (finding.suggestion !== undefined) lines.push(`  suggestion: ${finding.suggestion}`);
    }
  }
  if (result.priorFindings !== undefined) {
    lines.push("", "Prior findings:");
    for (const prior of result.priorFindings)
      lines.push(`- [${prior.id}] ${prior.status} · ${prior.note.replace(/\r?\n/g, " ")}`);
  }
  lines.push("", "Lenses:");
  for (const lens of result.lenses) lines.push(`- ${lens.name}: ${lens.assessment}`);
  if (rounds === undefined) {
    lines.push("", `Round ${meta.round} · head ${meta.headSha.slice(0, 7)} · ${verdict}`);
  } else {
    lines.push("", "Rounds:");
    for (const round of rounds)
      lines.push(
        `- round ${round.round} · ${round.headSha.slice(0, 7)} · ${round.verdict.replaceAll("_", " ")} · ${round.startedAt}`,
      );
  }
  return lines.join("\n");
}
