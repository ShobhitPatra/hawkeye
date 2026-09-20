import type { Finding, ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import type { RoundSummary } from "./render-text.js";
import { SEVERITY_LABELS, VERDICT_LABELS } from "./format.js";
import {
  footerLines,
  lensTableLines,
  oneLine,
  renderReviewSections,
  type ReviewComment,
  type RenderInput,
} from "./render.js";

export const LIVING_REVIEW_BODY_BUDGET = 64_000;
const SHORT_FORM_SUMMARY_LIMIT = 2_000;

export type RenderLivingReviewInput = Pick<
  RenderInput,
  "result" | "headSha" | "commentable" | "repositoryUrl"
> & {
  previousIds: Set<string>;
  priorClaims?: Record<string, string>;
  rounds: RoundSummary[];
  maxBodyLength?: number;
};
export type RenderedLivingReview = { body: string; comments: ReviewComment[]; trimmed: string[] };

type Trim = {
  keepRounds?: number;
  dropClosedPriors?: boolean;
  dropLenses?: boolean;
  claimOnly?: ReadonlySet<Finding["severity"]>;
};

const TRIM_LADDER: { note: string; trim: Trim }[] = [
  { note: "older rounds", trim: { keepRounds: 10 } },
  { note: "closed prior findings", trim: { keepRounds: 10, dropClosedPriors: true } },
  { note: "all but the current round", trim: { keepRounds: 1, dropClosedPriors: true } },
  { note: "the lens table", trim: { keepRounds: 1, dropClosedPriors: true, dropLenses: true } },
  {
    note: "optional finding detail",
    trim: {
      keepRounds: 1,
      dropClosedPriors: true,
      dropLenses: true,
      claimOnly: new Set(["optional"]),
    },
  },
  {
    note: "should fix finding detail",
    trim: {
      keepRounds: 1,
      dropClosedPriors: true,
      dropLenses: true,
      claimOnly: new Set(["optional", "should_fix"]),
    },
  },
  {
    note: "every finding's detail",
    trim: {
      keepRounds: 1,
      dropClosedPriors: true,
      dropLenses: true,
      claimOnly: new Set(["optional", "should_fix", "inherited", "must_fix"]),
    },
  },
];

function priorFindingLines(
  result: ReviewResult,
  priorClaims: Record<string, string> | undefined,
  dropClosed: boolean,
): string[] {
  if (result.priorFindings === undefined || result.priorFindings.length === 0) return [];
  const lines = ["", "#### Prior findings", ""];
  const currentClaims = new Map(
    result.findings.map(
      (finding) => [findingId(finding.path, finding.claim), finding.claim] as const,
    ),
  );
  let closed = 0;
  for (const prior of result.priorFindings) {
    if (dropClosed && prior.status !== "open") {
      closed += 1;
      continue;
    }
    const claim = priorClaims?.[prior.id] ?? currentClaims.get(prior.id);
    const dropped = prior.status === "open" && !currentClaims.has(prior.id);
    lines.push(
      `- \`${prior.id}\` ${prior.status}${claim === undefined ? "" : ` · ${oneLine(claim)}`} · ${oneLine(prior.note)}${dropped ? " (not repeated in findings; the verdict ignores it)" : ""}`,
    );
  }
  if (closed > 0)
    lines.push(`- ${closed} closed prior finding${closed === 1 ? "" : "s"} not shown.`);
  return lines;
}

function roundLines(rounds: RoundSummary[], keep: number | undefined): string[] {
  const shown = keep === undefined ? rounds : rounds.slice(-keep);
  const earlier = rounds.length - shown.length;
  const lines = [
    "",
    "<details>",
    "<summary>Rounds</summary>",
    "",
    "| Round | Head | Verdict | Started |",
    "|---|---|---|---|",
  ];
  if (earlier > 0) lines.push(`| ${earlier} earlier round${earlier === 1 ? "" : "s"} | | | |`);
  for (const round of shown)
    lines.push(
      `| ${round.round} | \`${round.headSha.slice(0, 7)}\` | ${roundVerdict(round.verdict)} | ${round.startedAt} |`,
    );
  lines.push("", "</details>");
  return lines;
}

function footerFor(input: RenderLivingReviewInput): string[] {
  const current = input.rounds.find((round) => round.headSha === input.headSha);
  return footerLines(input.repositoryUrl, {
    ...(current ? { round: current.round } : {}),
    ...(current?.turns === undefined ? {} : { turns: current.turns }),
  });
}

function renderWith(input: RenderLivingReviewInput, trim: Trim) {
  const { lines, comments } = renderReviewSections({
    result: input.result,
    headSha: input.headSha,
    commentable: input.commentable,
    commentWorthy: (finding: Finding) =>
      !input.previousIds.has(findingId(finding.path, finding.claim)),
    ...(trim.claimOnly === undefined ? {} : { claimOnly: trim.claimOnly }),
  });
  lines.push(...priorFindingLines(input.result, input.priorClaims, trim.dropClosedPriors ?? false));
  lines.push(...roundLines(input.rounds, trim.keepRounds));
  if (!trim.dropLenses) lines.push(...lensTableLines(input.result));
  lines.push(...footerFor(input));
  return { body: lines.join("\n"), comments };
}

export function renderMinimalLivingReview(
  input: Pick<RenderLivingReviewInput, "result" | "headSha" | "repositoryUrl" | "rounds">,
): string {
  const summary =
    input.result.summary.length > SHORT_FORM_SUMMARY_LIMIT
      ? `${input.result.summary.slice(0, SHORT_FORM_SUMMARY_LIMIT)}…`
      : input.result.summary;
  const { lines } = renderReviewSections({
    result: { ...input.result, summary, findings: [] },
    headSha: input.headSha,
    commentable: new Map(),
  });
  const counts = Object.entries(SEVERITY_LABELS)
    .map(([severity, label]) => {
      const count = input.result.findings.filter((f) => f.severity === severity).length;
      return count === 0 ? undefined : `${count} ${label.toLowerCase()}`;
    })
    .filter((part) => part !== undefined);
  lines.push(
    "",
    counts.length === 0 ? "No findings." : `Findings: ${counts.join(", ")}.`,
    "",
    "This review was too long for GitHub to accept in full. The complete findings are on the Hawkeye dashboard.",
  );
  lines.push(...footerFor({ ...input, commentable: new Map(), previousIds: new Set() }));
  return lines.join("\n");
}

export function renderLivingReview(input: RenderLivingReviewInput): RenderedLivingReview {
  const budget = input.maxBodyLength ?? LIVING_REVIEW_BODY_BUDGET;
  const full = renderWith(input, {});
  if (full.body.length <= budget) return { ...full, trimmed: [] };

  const trimmed: string[] = [];
  for (const step of TRIM_LADDER) {
    trimmed.push(step.note);
    const attempt = renderWith(input, step.trim);
    if (attempt.body.length <= budget) return { ...attempt, trimmed };
  }
  return {
    body: renderMinimalLivingReview(input),
    comments: full.comments,
    trimmed: [...trimmed, "the findings list"],
  };
}

function roundVerdict(verdict: RoundSummary["verdict"]): string {
  if (verdict === "pending") return "Pending";
  if (verdict === "invalid") return "Invalid";
  return VERDICT_LABELS[verdict];
}
