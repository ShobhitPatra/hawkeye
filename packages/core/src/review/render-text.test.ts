import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult, VERDICTS } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { LENS_LABELS, VERDICT_LABELS } from "./format.js";
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
        "Ship",
        "",
        "- Mostly fine.",
        "",
        "Lenses",
        ...LENSES.map((name) => `- ${LENS_LABELS[name]}: ${name} ok`),
        "",
        "Round 2 · head abcdef0 · Ship",
      ].join("\n"),
    );
  });
  it("groups findings by severity with ids and locations", () => {
    const text = renderReviewText({ result: base(), meta });
    expect(text).toContain(
      `Must fix\n- Null deref\n  src/a.ts:3 · ${findingId("src/a.ts", "Null deref")}\n  x may be undefined`,
    );
    expect(text).toContain(
      `Should fix\n- Rename\n  src/b.ts · ${findingId("src/b.ts", "Rename")}\n  too short`,
    );
    expect(text).toContain(
      `Inherited\n- Global state\n  ${findingId(undefined, "Global state")}\n  module singleton`,
    );
    expect(text.indexOf("Must fix")).toBeLessThan(text.indexOf("Should fix"));
    expect(text.indexOf("Should fix")).toBeLessThan(text.indexOf("Optional"));
    expect(text.indexOf("Optional")).toBeLessThan(text.indexOf("Inherited"));
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
  it("labels every verdict in words", () => {
    for (const verdict of VERDICTS) {
      const text = renderReviewText({ result: { ...base(), verdict }, meta });
      expect(text.startsWith(`${VERDICT_LABELS[verdict]}\n`)).toBe(true);
      expect(text.endsWith(`· ${VERDICT_LABELS[verdict]}`)).toBe(true);
    }
  });
  it("styles the verdict and headings, reddens Blocked and Must fix, and dims locations", () => {
    const style = {
      verdict: (text: string) => `<b>${text}</b>`,
      must: (text: string) => `<red>${text}</red>`,
      dim: (text: string) => `<dim>${text}</dim>`,
    };
    const text = renderReviewText({ result: { ...base(), verdict: "blocked" }, meta, style });
    expect(text.startsWith("<red><b>Blocked</b></red>\n")).toBe(true);
    expect(text).toContain("<red><b>Must fix</b></red>\n- Null deref\n  <dim>src/a.ts:3 · ");
    expect(text).toContain("<b>Should fix</b>\n");
    expect(text).toContain("<b>Lenses</b>\n");
    const plain = renderReviewText({ result: { ...base(), verdict: "blocked" }, meta });
    expect(text.replace(/<\/?(b|red|dim)>/g, "")).toBe(plain);
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
      "\nPrior findings\n- id1 addressed · guarded in the new commit\n- id2 open · still there (not repeated in findings; the verdict ignores it)\n\nLenses",
    );
    expect(text.indexOf("Inherited")).toBeLessThan(text.indexOf("Prior findings"));
    expect(renderReviewText({ result: base(), meta })).not.toContain("Prior findings");
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
        "Rounds\n- round 1 · 1111111 · Changes needed · 2026-08-25T10:00:00.000Z\n- round 2 · abcdef0 · Pending · 2026-08-26T10:00:00.000Z (this review)",
      ),
    ).toBe(true);
    expect(text).not.toContain("Round 2 · head");
  });
  it("omits the prior findings block when the list is empty", () => {
    const result = { ...base(), priorFindings: [] };
    expect(renderReviewText({ result, meta })).not.toContain("Prior findings");
  });
  it("prints the claim beside a prior finding id when known", () => {
    const result = {
      ...base(),
      priorFindings: [{ id: "id1", status: "addressed" as const, note: "guarded now" }],
    };
    expect(renderReviewText({ result, meta, priorClaims: { id1: "Null deref" } })).toContain(
      "- id1 addressed · Null deref · guarded now",
    );
    expect(renderReviewText({ result, meta })).toContain("- id1 addressed · guarded now");
  });
  it("flags an open prior finding that the findings do not repeat", () => {
    const result = {
      ...base(),
      priorFindings: [{ id: "id9", status: "open" as const, note: "still there" }],
    };
    expect(renderReviewText({ result, meta })).toContain(
      "- id9 open · still there (not repeated in findings; the verdict ignores it)",
    );
  });
});
