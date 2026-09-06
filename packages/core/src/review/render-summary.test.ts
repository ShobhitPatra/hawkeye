import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { formatDuration, renderReviewOutcomeLine, renderReviewSummary } from "./render-summary.js";

const base = (): ReviewResult => ({
  verdict: "blocked",
  summary: "- One bug.\n- Otherwise fine.",
  lenses: LENSES.map((name) => ({ name, assessment: `${name} ok` })),
  findings: [
    { path: "src/a.ts", line: 3, severity: "must_fix", claim: "Null deref", detail: "x" },
    { path: "src/b.ts", severity: "should_fix", claim: "Rename\nthe helper", detail: "y" },
    { severity: "inherited", claim: "Global state", detail: "z" },
  ],
});

describe("renderReviewSummary", () => {
  it("prints the verdict, the reason, one line per finding and the facts line", () => {
    expect(renderReviewSummary({ result: base(), meta: { round: 2 }, turns: 6 })).toBe(
      [
        "Blocked",
        "- One bug.",
        "- Otherwise fine.",
        "",
        "Must fix    Null deref",
        `            src/a.ts:3 · ${findingId("src/a.ts", "Null deref")}`,
        "",
        "Should fix  Rename the helper",
        `            src/b.ts · ${findingId("src/b.ts", "Rename\nthe helper")}`,
        "",
        "Inherited   Global state",
        `            ${findingId(undefined, "Global state")}`,
        "",
        "3 findings · round 2 · 6 turns",
      ].join("\n"),
    );
  });
  it("counts one finding and one turn in the singular and names the result file", () => {
    const result = { ...base(), findings: [base().findings[0]!] };
    const text = renderReviewSummary({
      result,
      meta: { round: 1 },
      turns: 1,
      resultPath: "/r/round-1/result.json",
    });
    expect(text.endsWith("1 finding · round 1 · 1 turn\nFull review: /r/round-1/result.json")).toBe(
      true,
    );
  });
  it("omits turns when unknown and lists prior findings with their claims", () => {
    const result: ReviewResult = {
      ...base(),
      findings: [],
      verdict: "ship",
      priorFindings: [
        { id: "abc123", status: "addressed", note: "Fixed in 6e0bf7f." },
        { id: "def456", status: "withdrawn", note: "By the author." },
      ],
    };
    expect(
      renderReviewSummary({ result, meta: { round: 3 }, priorClaims: { abc123: "Old claim" } }),
    ).toBe(
      [
        "Ship",
        "- One bug.",
        "- Otherwise fine.",
        "",
        "Prior       abc123 addressed · Old claim · Fixed in 6e0bf7f.",
        "Prior       def456 withdrawn · By the author.",
        "",
        "0 findings · round 3",
      ].join("\n"),
    );
  });
  it("omits the round when the caller has none", () => {
    const text = renderReviewSummary({ result: { ...base(), findings: [] }, turns: 3 });
    expect(text.endsWith("\n0 findings · 3 turns")).toBe(true);
  });
  it("applies the style hooks to the verdict, the must-fix label and dim lines", () => {
    const style = {
      verdict: (text: string) => `<v>${text}</v>`,
      must: (text: string) => `<m>${text}</m>`,
      dim: (text: string) => `<d>${text}</d>`,
    };
    const text = renderReviewSummary({
      result: base(),
      meta: { round: 1 },
      resultPath: "/p",
      style,
    });
    expect(text.startsWith("<v>Blocked</v>\n")).toBe(true);
    expect(text).toContain("<m>Must fix</m>    Null deref\n            <d>src/a.ts:3 · ");
    expect(text).toContain("Should fix  Rename the helper");
    expect(text.endsWith("<d>Full review: /p</d>")).toBe(true);
  });
});

describe("formatDuration", () => {
  it("prints minutes and zero-padded seconds", () => {
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(14_400)).toBe("0m 14s");
    expect(formatDuration(0)).toBe("0m 00s");
  });
});

describe("renderReviewOutcomeLine", () => {
  it("names the verdict, the counts and the duration, with must fix only when present", () => {
    expect(renderReviewOutcomeLine({ result: base(), turns: 6, durationMs: 252_000 })).toBe(
      "Blocked · 3 findings · 1 must fix · 6 turns · 4m 12s",
    );
    expect(
      renderReviewOutcomeLine({
        result: { ...base(), verdict: "ship", findings: [] },
        turns: 1,
        durationMs: 61_000,
      }),
    ).toBe("Ship · 0 findings · 1 turn · 1m 01s");
  });
  it("styles the verdict and the must-fix count", () => {
    expect(
      renderReviewOutcomeLine({
        result: base(),
        turns: 2,
        durationMs: 1000,
        style: { verdict: (text) => `<${text}>`, must: (text) => `[${text}]` },
      }),
    ).toBe("<Blocked> · 3 findings · [1 must fix] · 2 turns · 0m 01s");
  });
});
