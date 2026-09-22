import { type Finding, type ReviewResult, SEVERITIES } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { indentLines, LENS_LABELS, SEVERITY_LABELS, VERDICT_LABELS } from "./format.js";
import { encodeMarker } from "./marker.js";

export type ReviewComment = { path: string; line: number; side: "RIGHT" | "LEFT"; body: string };
export type RenderedReview = {
  event: "COMMENT";
  commit_id: string;
  body: string;
  comments: ReviewComment[];
};
export type FooterMeta = { round?: number; turns?: number; refusedModel?: string };
export type RenderInput = {
  result: ReviewResult;
  headSha: string;
  commentable: Map<string, Set<number>>;
  repositoryUrl: string;
  footer?: FooterMeta;
};

export function oneLine(text: string): string {
  return text.replace(/\r?\n/g, " ");
}

function tableCell(text: string): string {
  return oneLine(text).replaceAll("|", "\\|");
}

function collapsible(summary: string, content: string, indent: string): string[] {
  return [
    `${indent}<details><summary>${summary}</summary>`,
    "",
    ...indentLines(content, indent),
    "",
    `${indent}</details>`,
  ];
}

function location(finding: Finding): string {
  if (finding.path === undefined) return "";
  return ` \`${finding.path}${finding.line === undefined ? "" : `:${finding.line}`}\``;
}

function findingBody(finding: Finding): string {
  const parts = [
    `**${SEVERITY_LABELS[finding.severity]}** · ${oneLine(finding.claim)}`,
    "",
    finding.detail,
  ];
  if (finding.rationale !== undefined) parts.push("", ...collapsible("why", finding.rationale, ""));
  if (finding.suggestion !== undefined) parts.push("", "```suggestion", finding.suggestion, "```");
  return parts.join("\n");
}

function isAnchored(
  finding: Finding,
  commentable: Map<string, Set<number>>,
): finding is Finding & { path: string; line: number } {
  return (
    finding.path !== undefined &&
    finding.line !== undefined &&
    (commentable.get(finding.path)?.has(finding.line) ?? false)
  );
}

export type ReviewSections = { lines: string[]; comments: ReviewComment[] };

export function renderReviewSections({
  result,
  headSha,
  commentable,
  commentWorthy,
  claimOnly,
}: Pick<RenderInput, "result" | "headSha" | "commentable"> & {
  commentWorthy?: (finding: Finding) => boolean;
  claimOnly?: ReadonlySet<Finding["severity"]>;
}): ReviewSections {
  const comments: ReviewComment[] = [];
  const anchored = new Set<Finding>();
  for (const finding of result.findings) {
    if (!isAnchored(finding, commentable)) continue;
    if (commentWorthy !== undefined && !commentWorthy(finding)) continue;
    anchored.add(finding);
    comments.push({
      path: finding.path,
      line: finding.line,
      side: "RIGHT",
      body: findingBody(finding),
    });
  }

  const lines: string[] = [
    encodeMarker(headSha),
    "",
    `### ${VERDICT_LABELS[result.verdict]}`,
    "",
    result.summary,
  ];

  for (const severity of SEVERITIES) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push("", `#### ${SEVERITY_LABELS[severity]}`, "");
    for (const f of group) {
      const id = `\`${findingId(f.path, f.claim)}\``;
      lines.push(`- **${oneLine(f.claim)}**${location(f)}`);
      if (anchored.has(f)) {
        lines.push(`  Posted inline at the line. ${id}`);
        continue;
      }
      if (claimOnly?.has(f.severity)) {
        lines[lines.length - 1] = `${lines[lines.length - 1]} ${id}`;
        continue;
      }
      const detail = indentLines(f.detail.trimEnd(), "  ");
      detail[detail.length - 1] = `${detail[detail.length - 1]} ${id}`;
      lines.push(...detail);
      if (f.rationale !== undefined) lines.push("", ...collapsible("why", f.rationale, "  "));
    }
  }

  return { lines, comments };
}

export function lensTableLines(result: Pick<ReviewResult, "lenses">): string[] {
  const lines = [
    "",
    "<details>",
    "<summary>Review lenses</summary>",
    "",
    "| Lens | Assessment |",
    "|---|---|",
  ];
  for (const lens of result.lenses)
    lines.push(`| ${LENS_LABELS[lens.name]} | ${tableCell(lens.assessment)} |`);
  lines.push("", "</details>");
  return lines;
}

export function footerLines(repositoryUrl: string, meta: FooterMeta = {}): string[] {
  const facts = [
    `Reviewed by [Hawkeye](${repositoryUrl}) on the author's own plan`,
    ...(meta.round === undefined ? [] : [`round ${meta.round}`]),
    ...(meta.turns === undefined ? [] : [`${meta.turns} turn${meta.turns === 1 ? "" : "s"}`]),
    ...(meta.refusedModel === undefined
      ? []
      : [`reviewed on the default model because ${meta.refusedModel} was refused`]),
  ];
  return ["", "---", facts.join(" · ")];
}

export function renderReview({
  result,
  headSha,
  commentable,
  repositoryUrl,
  footer,
}: RenderInput): RenderedReview {
  const { lines, comments } = renderReviewSections({ result, headSha, commentable });
  lines.push(...lensTableLines(result));
  lines.push(...footerLines(repositoryUrl, footer));
  return { event: "COMMENT", commit_id: headSha, body: lines.join("\n"), comments };
}
