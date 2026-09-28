import { type Finding, type ReviewResult, SEVERITIES, type Verdict } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { indentLines, LENS_LABELS, SEVERITY_LABELS, VERDICT_LABELS } from "./format.js";
import type { ReviewTextStyle } from "./render-summary.js";

export type RoundSummary = {
  round: number;
  headSha: string;
  verdict: Verdict | "pending" | "invalid";
  startedAt: string;
  turns?: number;
  refusedModel?: string;
};
export type RenderTextInput = {
  result: ReviewResult;
  meta: { round: number; headSha: string };
  rounds?: RoundSummary[];
  priorClaims?: Record<string, string>;
  style?: Partial<ReviewTextStyle>;
};

const PLAIN: ReviewTextStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
};

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ");
}

function verdictLabel(verdict: RoundSummary["verdict"]): string {
  if (verdict === "pending") return "Pending";
  if (verdict === "invalid") return "Invalid";
  return VERDICT_LABELS[verdict];
}

function where(finding: Finding): string {
  const location =
    finding.path === undefined
      ? []
      : [`${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}`];
  return [...location, findingId(finding.path, finding.claim)].join(" · ");
}

export function renderReviewText(input: RenderTextInput): string {
  const { result, meta, rounds, priorClaims } = input;
  const style = { ...PLAIN, ...input.style };
  const heading = (text: string, must = false) =>
    must ? style.must(style.verdict(text)) : style.verdict(text);
  const lines = [
    heading(VERDICT_LABELS[result.verdict], result.verdict === "blocked"),
    "",
    result.summary,
  ];
  for (const severity of SEVERITIES) {
    const group = result.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push("", heading(SEVERITY_LABELS[severity], severity === "must_fix"));
    for (const finding of group) {
      lines.push(`- ${oneLine(finding.claim)}`, `  ${style.dim(where(finding))}`);
      lines.push(...indentLines(finding.detail, "  "));
      if (finding.rationale !== undefined)
        lines.push(
          `  ${style.dim("why:")} ${indentLines(finding.rationale, "  ").join("\n").trimStart()}`,
        );
      if (finding.suggestion !== undefined)
        lines.push(`  ${style.dim("suggestion:")} ${finding.suggestion}`);
    }
  }
  if (result.priorFindings !== undefined && result.priorFindings.length > 0) {
    lines.push("", heading("Prior findings"));
    const repeated = new Set(
      result.findings.map((finding) => findingId(finding.path, finding.claim)),
    );
    for (const prior of result.priorFindings) {
      const claim = priorClaims?.[prior.id];
      const dropped = prior.status === "open" && !repeated.has(prior.id);
      lines.push(
        `- ${style.dim(prior.id)} ${prior.status}${claim === undefined ? "" : ` · ${oneLine(claim)}`} · ${oneLine(prior.note)}${dropped ? " (not repeated in findings; the verdict ignores it)" : ""}`,
      );
    }
  }
  lines.push("", heading("Lenses"));
  for (const lens of result.lenses) lines.push(`- ${LENS_LABELS[lens.name]}: ${lens.assessment}`);
  if (rounds === undefined || rounds.length === 0) {
    lines.push(
      "",
      style.dim(
        `Round ${meta.round} · head ${meta.headSha.slice(0, 7)} · ${verdictLabel(result.verdict)}`,
      ),
    );
  } else {
    lines.push("", heading("Rounds"));
    for (const round of rounds)
      lines.push(
        style.dim(
          `- round ${round.round} · ${round.headSha.slice(0, 7)} · ${verdictLabel(round.verdict)} · ${round.startedAt}${round.round === meta.round ? " (this review)" : ""}`,
        ),
      );
  }
  return lines.join("\n");
}
