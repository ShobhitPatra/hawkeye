import { type Finding, type ReviewResult, SEVERITIES } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { indentLines, SEVERITY_BADGE } from "./format.js";
import { encodeMarker } from "./marker.js";

export type ReviewComment = { path: string; line: number; side: "RIGHT" | "LEFT"; body: string };
export type RenderedReview = {
  event: "COMMENT";
  commit_id: string;
  body: string;
  comments: ReviewComment[];
};
export type RenderInput = {
  result: ReviewResult;
  headSha: string;
  commentable: Map<string, Set<number>>;
  repositoryUrl: string;
};

function oneLine(text: string): string {
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

function findingBody(finding: Finding): string {
  const parts = [
    `**${SEVERITY_BADGE[finding.severity]}** · ${oneLine(finding.claim)}`,
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

export function renderReview({
  result,
  headSha,
  commentable,
  repositoryUrl,
}: RenderInput): RenderedReview {
  const comments: ReviewComment[] = [];
  const anchored = new Set<Finding>();
  for (const finding of result.findings) {
    if (!isAnchored(finding, commentable)) continue;
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
    `## <small>Verdict:</small> ${result.verdict.replaceAll("_", " ")}`,
    "",
    result.summary,
  ];

  if (result.findings.length > 0) {
    lines.push("", "## Findings");
    for (const severity of SEVERITIES) {
      const group = result.findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push("", `### ${SEVERITY_BADGE[severity]}`);
      for (const f of group) {
        const location =
          f.path === undefined ? "" : ` — \`${f.path}${f.line === undefined ? "" : `:${f.line}`}\``;
        const headline = `- \`${findingId(f.path, f.claim)}\` **${oneLine(f.claim)}**${location}`;
        if (anchored.has(f)) {
          lines.push(`${headline} (inline)`);
          continue;
        }
        lines.push(headline, ...indentLines(f.detail, "  "));
        if (f.rationale !== undefined) lines.push("", ...collapsible("why", f.rationale, "  "));
      }
    }
  }

  lines.push(
    "",
    "<details>",
    "<summary>Review lenses</summary>",
    "",
    "| Lens | Assessment |",
    "|---|---|",
  );
  for (const lens of result.lenses)
    lines.push(`| \`${lens.name}\` | ${tableCell(lens.assessment)} |`);
  lines.push("", "</details>");

  lines.push("", "---", `Reviewed by [Hawkeye](${repositoryUrl}) on the author's own plan.`);
  return { event: "COMMENT", commit_id: headSha, body: lines.join("\n"), comments };
}
