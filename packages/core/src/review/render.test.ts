import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult } from "../contract/schema.js";
import { renderReview } from "./render.js";

const base = (): ReviewResult => ({
  verdict: "revise",
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
  it("renders the verdict above the summary", () => {
    const r = renderReview(input());
    expect(r.body).toContain("**Verdict:** revise");
    expect(r.body.indexOf("**Verdict:** revise")).toBeLessThan(r.body.indexOf("Mostly fine."));
  });
  it("orders marker, verdict, findings, lens details and footer", () => {
    const r = renderReview(input());
    const marker = r.body.indexOf("<!-- hawkeye:");
    const verdict = r.body.indexOf("**Verdict:**");
    const findings = r.body.indexOf("## Findings");
    const details = r.body.indexOf("<details>");
    const footer = r.body.indexOf("Reviewed by [Hawkeye]");
    expect(marker).toBeLessThan(verdict);
    expect(verdict).toBeLessThan(findings);
    expect(findings).toBeLessThan(details);
    expect(details).toBeLessThan(footer);
  });
  it("collapses the lens table inside a details block", () => {
    const r = renderReview(input());
    expect(r.body).toContain(
      "<details>\n<summary>Review lenses</summary>\n\n| Lens | Assessment |",
    );
    expect(r.body).toContain("\n\n</details>");
    for (const lens of LENSES) expect(r.body).toContain(`| ${lens} |`);
  });
  it("groups body findings by severity with hyphenated headings", () => {
    const r = renderReview(input());
    expect(r.body).toContain("### should-fix");
    expect(r.body).toContain("### inherited");
    expect(r.body.indexOf("### should-fix")).toBeLessThan(r.body.indexOf("### inherited"));
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
  it("demotes out-of-diff and unanchored findings into the body with their ids", () => {
    const r = renderReview(input());
    expect(r.body).toContain("Rename");
    expect(r.body).toContain("src/a.ts:99");
    expect(r.body).toContain("Global state");
    expect(r.body).toMatch(/`[0-9a-f]{12}`/);
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
    expect(r.body).toContain("| intent | line one line two \\| pipe |");
    const lensRows = r.body
      .split("\n")
      .filter((line) => line.startsWith("| ") && line !== "| Lens | Assessment |");
    expect(lensRows).toHaveLength(LENSES.length);
  });
});
