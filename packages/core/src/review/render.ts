import { type Finding, type ReviewResult, type Severity } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
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

const SEVERITY_ORDER = ["must_fix", "should_fix", "inherited"] as const;

const SEVERITY_BADGE: Record<Severity, string> = {
  must_fix: "must-fix",
  should_fix: "should-fix",
  inherited: "inherited",
};

function tableCell(text: string): string {
  return text.replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function findingBody(finding: Finding): string {
  const parts = [`**${SEVERITY_BADGE[finding.severity]}** · ${finding.claim}`, "", finding.detail];
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
  const inBody: Finding[] = [];
  for (const finding of result.findings) {
    if (isAnchored(finding, commentable))
      comments.push({
        path: finding.path,
        line: finding.line,
        side: "RIGHT",
        body: findingBody(finding),
      });
    else inBody.push(finding);
  }

  const lines: string[] = [
    encodeMarker(headSha),
    "",
    `**Verdict:** ${result.verdict}`,
    "",
    result.summary,
  ];

  if (inBody.length > 0) {
    lines.push("", "## Findings");
    for (const severity of SEVERITY_ORDER) {
      const group = inBody.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push("", `### ${SEVERITY_BADGE[severity]}`);
      for (const f of group) {
        const location =
          f.path === undefined ? "" : ` — \`${f.path}${f.line === undefined ? "" : `:${f.line}`}\``;
        lines.push(
          `- \`${findingId(f.path, f.claim)}\` **${f.claim}**${location}`,
          `  ${f.detail}`,
        );
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
  for (const lens of result.lenses) lines.push(`| ${lens.name} | ${tableCell(lens.assessment)} |`);
  lines.push("", "</details>");

  lines.push("", "---", `Reviewed by [Hawkeye](${repositoryUrl}) on the author's own plan.`);
  return { event: "COMMENT", commit_id: headSha, body: lines.join("\n"), comments };
}
