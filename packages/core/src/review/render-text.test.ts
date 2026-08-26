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
});
