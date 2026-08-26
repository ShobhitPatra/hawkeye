import { type Finding, type ReviewResult, SEVERITIES } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { indentLines, SEVERITY_BADGE } from "./format.js";

export type RenderTextInput = { result: ReviewResult; meta: { round: number; headSha: string } };

function headline(finding: Finding): string {
  const location =
    finding.path === undefined
      ? ""
      : ` (${finding.path}${finding.line === undefined ? "" : `:${finding.line}`})`;
  return `- [${findingId(finding.path, finding.claim)}] ${finding.claim.replace(/\r?\n/g, " ")}${location}`;
}

export function renderReviewText({ result, meta }: RenderTextInput): string {
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
  lines.push("", "Lenses:");
  for (const lens of result.lenses) lines.push(`- ${lens.name}: ${lens.assessment}`);
  lines.push("", `Round ${meta.round} · head ${meta.headSha.slice(0, 7)} · ${verdict}`);
  return lines.join("\n");
}
