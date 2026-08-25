import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult } from "../contract/schema.js";
import { renderReview } from "./render.js";

const base = (): ReviewResult => ({
  verdict: "changes_needed",
  summary: "Mostly fine.",
  lenses: LENSES.map((name) => ({ name, assessment: `${name} ok` })),
  findings: [
    {
      path: "src/a.ts",
      line: 3,
      severity: "must_fix",
      claim: "Null deref",
      detail: "x may be undefined",
      suggestion: "const y = x ?? 0;",
    },
    { path: "src/a.ts", line: 99, severity: "should_fix", claim: "Rename", detail: "too short" },
    { severity: "optional", claim: "Extra test", detail: "cover the empty case" },
    { severity: "inherited", claim: "Global state", detail: "module singleton" },
  ],
});
const commentable = new Map([["src/a.ts", new Set([1, 2, 3])]]);
const input = () => ({
  result: base(),
  headSha: "a".repeat(40),
  commentable,
  repositoryUrl: "https://github.com/ShobhitPatra/hawkeye",
});

describe("renderReview", () => {
  it("always comments and pins the head sha", () => {
    const r = renderReview(input());
    expect(r.event).toBe("COMMENT");
    expect(r.commit_id).toBe("a".repeat(40));
  });
  it("puts the marker first and the credit footer last", () => {
    const r = renderReview(input());
    expect(r.body.startsWith(`<!-- hawkeye: head=${"a".repeat(40)} -->`)).toBe(true);
    expect(r.body.trimEnd().endsWith("on the author's own plan.")).toBe(true);
    expect(r.body).toContain("https://github.com/ShobhitPatra/hawkeye");
  });
  it("renders the verdict as a heading above the summary", () => {
    const r = renderReview(input());
    expect(r.body).toContain("## <small>Verdict:</small> changes needed");
    expect(r.body.indexOf("## <small>Verdict:</small> changes needed")).toBeLessThan(
      r.body.indexOf("Mostly fine."),
    );
  });
  it("renders each verdict as its label", () => {
    const labels = {
      ship: "ship",
      mergeable: "mergeable",
      changes_needed: "changes needed",
      blocked: "blocked",
    } as const;
    for (const [verdict, label] of Object.entries(labels)) {
      const i = input();
      i.result.verdict = verdict as keyof typeof labels;
      expect(renderReview(i).body).toContain(`## <small>Verdict:</small> ${label}\n`);
    }
  });
  it("orders marker, verdict, findings, lens details and footer", () => {
    const r = renderReview(input());
    const marker = r.body.indexOf("<!-- hawkeye:");
    const verdict = r.body.indexOf("## <small>Verdict:</small>");
    const findings = r.body.indexOf("## Findings");
    const details = r.body.indexOf("<details>\n<summary>Review lenses</summary>");
    const footer = r.body.indexOf("Reviewed by [Hawkeye]");
    expect(marker).toBeLessThan(verdict);
    expect(verdict).toBeLessThan(findings);
    expect(findings).toBeLessThan(details);
    expect(details).toBeLessThan(footer);
  });
  it("collapses the lens table inside a details block", () => {
    const r = renderReview(input());
    expect(r.body).toContain(
      "<details>\n<summary>Review lenses</summary>\n\n| Lens | Assessment |\n|---|---|",
    );
    expect(r.body).toContain("\n\n</details>");
    for (const lens of LENSES) expect(r.body).toContain(`| \`${lens}\` | ${lens} ok |`);
  });
  it("groups body findings by severity with hyphenated headings", () => {
    const r = renderReview(input());
    expect(r.body).toContain("### should-fix");
    expect(r.body).toContain("### optional");
    expect(r.body).toContain("### inherited");
    expect(r.body.indexOf("### must-fix")).toBeLessThan(r.body.indexOf("### should-fix"));
    expect(r.body.indexOf("### should-fix")).toBeLessThan(r.body.indexOf("### optional"));
    expect(r.body.indexOf("### optional")).toBeLessThan(r.body.indexOf("### inherited"));
  });
  it("anchors in-diff findings as comments with a suggestion fence", () => {
    const r = renderReview(input());
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
    expect(r.comments[0]!.body).toContain("```suggestion\nconst y = x ?? 0;\n```");
    expect(r.comments[0]!.body.startsWith("**must-fix** · Null deref")).toBe(true);
  });
  it("forces RIGHT side even when the finding asks for LEFT", () => {
    const result = base();
    result.findings[0]!.side = "LEFT";
    const r = renderReview({ ...input(), result });
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
  });
  it("lists out-of-diff and unanchored findings in the body with their ids", () => {
    const r = renderReview(input());
    expect(r.body).toContain("Rename");
    expect(r.body).toContain("src/a.ts:99");
    expect(r.body).toContain("Global state");
    expect(r.body).toMatch(/`[0-9a-f]{12}`/);
  });
  it("lists an anchored finding in the body as a one-liner marked inline", () => {
    const r = renderReview(input());
    expect(r.body).toContain("### must-fix");
    expect(r.body).toMatch(/- `[0-9a-f]{12}` \*\*Null deref\*\* — `src\/a\.ts:3` \(inline\)\n/);
    expect(r.body).not.toContain("x may be undefined");
    expect(r.comments).toHaveLength(1);
  });
  it("keeps the findings section when every finding is anchored", () => {
    const i = input();
    i.result.findings = [i.result.findings[0]!];
    const r = renderReview(i);
    expect(r.body).toContain("## Findings");
    expect(r.body).toContain("(inline)");
    expect(r.body).not.toContain("### should-fix");
  });
  it("collapses a body finding rationale under a why block", () => {
    const i = input();
    i.result.findings[1]!.rationale = "The old name is used in three call sites.";
    const r = renderReview(i);
    expect(r.body).toContain(
      "  <details><summary>why</summary>\n\n  The old name is used in three call sites.\n\n  </details>",
    );
  });
  it("keeps a multi-line claim and detail inside the finding bullet", () => {
    const i = input();
    i.result.findings[1]!.claim = "a\nb";
    i.result.findings[1]!.detail = "x\n\ny";
    const r = renderReview(i);
    expect(r.body).toContain("**a b**");
    expect(r.body).toContain("  x");
    expect(r.body).toContain("  y");
    expect(r.body).not.toContain("\ny");
  });
  it("keeps a multi-line claim on one line in an inline comment", () => {
    const i = input();
    i.result.findings[0]!.claim = "a\nb";
    const r = renderReview(i);
    expect(r.comments[0]!.body.startsWith("**must-fix** · a b")).toBe(true);
  });
  it("keeps a multi-line rationale inside the finding bullet", () => {
    const i = input();
    i.result.findings[1]!.rationale = "first\n\nsecond line";
    const r = renderReview(i);
    expect(r.body).toContain("  first");
    expect(r.body).toContain("  second line");
    expect(r.body).not.toContain("\nsecond line");
  });
  it("omits the why block from a body finding without a rationale", () => {
    const r = renderReview(input());
    expect(r.body).not.toContain("<summary>why</summary>");
  });
  it("collapses an inline comment rationale under a why block before the suggestion", () => {
    const i = input();
    i.result.findings[0]!.rationale = "Reproduced by calling f with an empty map.";
    const r = renderReview(i);
    const body = r.comments[0]!.body;
    expect(body).toContain(
      "<details><summary>why</summary>\n\nReproduced by calling f with an empty map.\n\n</details>",
    );
    expect(body.indexOf("<summary>why</summary>")).toBeLessThan(body.indexOf("```suggestion"));
    expect(body.indexOf("x may be undefined")).toBeLessThan(body.indexOf("<summary>why</summary>"));
  });
  it("omits the why block from an inline comment without a rationale", () => {
    const r = renderReview(input());
    expect(r.comments[0]!.body).not.toContain("<summary>why</summary>");
  });
  it("omits the findings section when there are none", () => {
    const i = input();
    i.result.findings = [];
    expect(renderReview(i).body).not.toContain("## Findings");
  });
  it("keeps the lens table on one row per lens", () => {
    const i = input();
    i.result.lenses = i.result.lenses.map((l) =>
      l.name === "intent" ? { ...l, assessment: "line one\nline two | pipe" } : l,
    );
    const r = renderReview(i);
    expect(r.body).toContain("| `intent` | line one line two \\| pipe |");
    const lensRows = r.body
      .split("\n")
      .filter((line) => line.startsWith("| ") && line !== "| Lens | Assessment |");
    expect(lensRows).toHaveLength(LENSES.length);
  });
});
