import { type Finding, type ReviewResult, SEVERITIES } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { SEVERITY_LABELS, VERDICT_LABELS } from "./format.js";

export type ReviewTextStyle = {
  verdict(text: string): string;
  must(text: string): string;
  dim(text: string): string;
};

export type RenderSummaryInput = {
  result: ReviewResult;
  meta: { round: number };
  turns?: number;
  priorClaims?: Record<string, string>;
  resultPath?: string;
  style?: Partial<ReviewTextStyle>;
};

const PLAIN: ReviewTextStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
};
const GUTTER_WIDTH = 12;

function gutter(label: string): string {
  return label.padEnd(GUTTER_WIDTH);
}

function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ");
}

function location(finding: Finding): string {
  if (finding.path === undefined) return "";
  return `${finding.path}${finding.line === undefined ? "" : `:${finding.line}`} · `;
}

export function renderReviewSummary(input: RenderSummaryInput): string {
  const style = { ...PLAIN, ...input.style };
  const { result } = input;
  const lines = [style.verdict(VERDICT_LABELS[result.verdict]), result.summary];
  for (const severity of SEVERITIES) {
    const group = result.findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push("");
    const label = SEVERITY_LABELS[severity];
    const styledLabel = severity === "must_fix" ? style.must(label) : label;
    for (const finding of group) {
      lines.push(
        `${styledLabel}${" ".repeat(GUTTER_WIDTH - label.length)}${oneLine(finding.claim)}`,
        `${gutter("")}${style.dim(`${location(finding)}${findingId(finding.path, finding.claim)}`)}`,
      );
    }
  }
  if (result.priorFindings !== undefined && result.priorFindings.length > 0) {
    lines.push("");
    for (const prior of result.priorFindings) {
      const claim = input.priorClaims?.[prior.id];
      lines.push(
        `${gutter("Prior")}${style.dim(prior.id)} ${prior.status}${claim === undefined ? "" : ` · ${oneLine(claim)}`} · ${oneLine(prior.note)}`,
      );
    }
  }
  const count = result.findings.length;
  const facts = [
    `${count} finding${count === 1 ? "" : "s"}`,
    `round ${input.meta.round}`,
    ...(input.turns === undefined ? [] : [`${input.turns} turn${input.turns === 1 ? "" : "s"}`]),
  ];
  lines.push("", facts.join(" · "));
  if (input.resultPath !== undefined) lines.push(style.dim(`Full review: ${input.resultPath}`));
  return lines.join("\n");
}
