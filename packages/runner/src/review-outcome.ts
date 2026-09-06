import { type ReviewResult, type ReviewTextStyle, VERDICT_LABELS } from "@hawkeye/core";

const PLAIN: ReviewTextStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
};

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

export function reviewOutcomeLine(input: {
  result: ReviewResult;
  turns: number;
  durationMs: number;
  style?: Partial<ReviewTextStyle>;
}): string {
  const style = { ...PLAIN, ...input.style };
  const mustFix = input.result.findings.filter((finding) => finding.severity === "must_fix").length;
  return [
    style.verdict(VERDICT_LABELS[input.result.verdict]),
    count(input.result.findings.length, "finding"),
    ...(mustFix === 0 ? [] : [style.must(`${mustFix} must fix`)]),
    count(input.turns, "turn"),
    formatDuration(input.durationMs),
  ].join(" · ");
}

export function reviewProgressLine(input: {
  subject: string;
  turns: number;
  elapsedMs: number;
}): string {
  return `Reviewing ${input.subject} · ${count(input.turns, "turn")} · ${formatDuration(input.elapsedMs)}`;
}
