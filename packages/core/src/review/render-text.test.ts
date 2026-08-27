import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult, VERDICTS } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { renderReviewText } from "./render-text.js";

const base = (): ReviewResult => ({
  verdict: "changes_needed",
  summary: "- Mostly fine.",
  lenses: LENSES.map((name) => ({ name, assessment: `${name} ok` })),
  findings: [
    {
      path: "src/a.ts",
      line: 3,
      severity: "must_fix",
      claim: "Null deref",
      detail: "x may be undefined",
    },
    { path: "src/b.ts", severity: "should_fix", claim: "Rename", detail: "too short" },
    {
      severity: "optional",
      claim: "Extra test",
      detail: "cover the empty case",
      rationale: "See the\nspec.",
    },
    { severity: "inherited", claim: "Global state", detail: "module singleton" },
  ],
});
const meta = { round: 2, headSha: "abcdef0123456789" };

describe("renderReviewText", () => {
  it("prints verdict, summary, lenses and footer with no findings", () => {
    const result = { ...base(), verdict: "ship" as const, findings: [] };
    expect(renderReviewText({ result, meta })).toBe(
      [
        "Verdict: SHIP",
        "",
        "- Mostly fine.",
        "",
        "Lenses:",
        ...LENSES.map((name) => `- ${name}: ${name} ok`),
        "",
        "Round 2 · head abcdef0 · ship",
      ].join("\n"),
    );
  });
  it("groups findings by severity with ids and locations", () => {
    const text = renderReviewText({ result: base(), meta });
    expect(text).toContain(
      `must-fix:\n- [${findingId("src/a.ts", "Null deref")}] Null deref (src/a.ts:3)\n  x may be undefined`,
    );
    expect(text).toContain(
      `should-fix:\n- [${findingId("src/b.ts", "Rename")}] Rename (src/b.ts)\n  too short`,
    );
    expect(text).toContain(
      `inherited:\n- [${findingId(undefined, "Global state")}] Global state\n  module singleton`,
    );
    expect(text.indexOf("must-fix:")).toBeLessThan(text.indexOf("should-fix:"));
    expect(text.indexOf("should-fix:")).toBeLessThan(text.indexOf("optional:"));
    expect(text.indexOf("optional:")).toBeLessThan(text.indexOf("inherited:"));
  });
  it("indents the rationale under why", () => {
    const text = renderReviewText({ result: base(), meta });
    expect(text).toContain("  cover the empty case\n  why: See the\n  spec.\n");
  });
  it("prints a suggestion under the finding", () => {
    const result = base();
    result.findings[0]!.suggestion = "const y = x ?? 0;";
    expect(renderReviewText({ result, meta })).toContain(
      "  x may be undefined\n  suggestion: const y = x ?? 0;",
    );
  });
  it("labels every verdict without underscores", () => {
    for (const verdict of VERDICTS) {
      const text = renderReviewText({ result: { ...base(), verdict }, meta });
      const label = verdict.replaceAll("_", " ");
      expect(text.startsWith(`Verdict: ${label.toUpperCase()}\n`)).toBe(true);
      expect(text.endsWith(`· ${label}`)).toBe(true);
    }
  });
  it("lists prior findings with their status after the findings", () => {
    const result = {
      ...base(),
      priorFindings: [
        { id: "id1", status: "addressed" as const, note: "guarded in\nthe new commit" },
        { id: "id2", status: "open" as const, note: "still there" },
      ],
    };
    const text = renderReviewText({ result, meta });
    expect(text).toContain(
      "\nPrior findings:\n- [id1] addressed · guarded in the new commit\n- [id2] open · still there\n\nLenses:",
    );
    expect(text.indexOf("inherited:")).toBeLessThan(text.indexOf("Prior findings:"));
    expect(renderReviewText({ result: base(), meta })).not.toContain("Prior findings:");
  });
  it("replaces the footer with a rounds table when rounds are given", () => {
    const text = renderReviewText({
      result: base(),
      meta,
      rounds: [
        {
          round: 1,
          headSha: "1".repeat(40),
          verdict: "changes_needed",
          startedAt: "2026-08-25T10:00:00.000Z",
        },
        {
          round: 2,
          headSha: "abcdef0123456789",
          verdict: "pending",
          startedAt: "2026-08-26T10:00:00.000Z",
        },
      ],
    });
    expect(
      text.endsWith(
        "Rounds:\n- round 1 · 1111111 · changes needed · 2026-08-25T10:00:00.000Z\n- round 2 · abcdef0 · pending · 2026-08-26T10:00:00.000Z (this review)",
      ),
    ).toBe(true);
    expect(text).not.toContain("Round 2 · head");
  });
  it("omits the prior findings block when the list is empty", () => {
    const result = { ...base(), priorFindings: [] };
    expect(renderReviewText({ result, meta })).not.toContain("Prior findings:");
  });
  it("prints the claim beside a prior finding id when known", () => {
    const result = {
      ...base(),
      priorFindings: [{ id: "id1", status: "addressed" as const, note: "guarded now" }],
    };
    expect(renderReviewText({ result, meta, priorClaims: { id1: "Null deref" } })).toContain(
      "- [id1] addressed · Null deref · guarded now",
    );
    expect(renderReviewText({ result, meta })).toContain("- [id1] addressed · guarded now");
  });
});
