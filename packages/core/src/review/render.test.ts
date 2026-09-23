import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult, VERDICTS } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { footerLines, renderReview } from "./render.js";

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
    expect(r.body.trimEnd().endsWith("on the author's own plan")).toBe(true);
    expect(r.body).toContain("https://github.com/ShobhitPatra/hawkeye");
  });
  it("renders the verdict word as a level-three heading above the summary", () => {
    const r = renderReview(input());
    expect(r.body).toContain("\n### Changes needed\n\nMostly fine.");
  });
  it("renders every verdict as its human label", () => {
    const labels: Record<(typeof VERDICTS)[number], string> = {
      ship: "Ship",
      mergeable: "Mergeable",
      changes_needed: "Changes needed",
      blocked: "Blocked",
    };
    for (const verdict of VERDICTS) {
      const i = input();
      i.result.verdict = verdict;
      expect(/^### (.+)$/m.exec(renderReview(i).body)?.[1]).toBe(labels[verdict]);
    }
  });
  it("orders marker, verdict, findings, lens details and footer", () => {
    const r = renderReview(input());
    const marker = r.body.indexOf("<!-- hawkeye:");
    const verdict = r.body.indexOf("### Changes needed");
    const findings = r.body.indexOf("#### Must fix");
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
    expect(r.body).toContain("| Blast radius | blast_radius ok |");
    expect(r.body).not.toContain("`intent`");
  });
  it("groups body findings by severity under human labels in contract order", () => {
    const r = renderReview(input());
    const at = (heading: string) => r.body.indexOf(`#### ${heading}`);
    expect(at("Must fix")).toBeGreaterThan(0);
    expect(at("Must fix")).toBeLessThan(at("Should fix"));
    expect(at("Should fix")).toBeLessThan(at("Optional"));
    expect(at("Optional")).toBeLessThan(at("Inherited"));
    expect(r.body).not.toContain("must-fix");
  });
  it("anchors in-diff findings as comments with a suggestion fence", () => {
    const r = renderReview(input());
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
    expect(r.comments[0]!.body).toContain("```suggestion\nconst y = x ?? 0;\n```");
    expect(r.comments[0]!.body.startsWith("**Must fix** · Null deref")).toBe(true);
    expect(
      r.comments[0]!.body.endsWith(
        `<!-- hawkeye: finding=${findingId("src/a.ts", "Null deref")} -->`,
      ),
    ).toBe(true);
  });
  it("forces RIGHT side even when the finding asks for LEFT", () => {
    const result = base();
    result.findings[0]!.side = "LEFT";
    const r = renderReview({ ...input(), result });
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
  });
  it("lists a body finding as claim, location, detail and id", () => {
    const r = renderReview(input());
    expect(r.body).toMatch(/- \*\*Rename\*\* `src\/a\.ts:99`\n  too short `[0-9a-f]{12}`\n/);
    expect(r.body).toMatch(/- \*\*Global state\*\*\n  module singleton `[0-9a-f]{12}`/);
    expect(r.body).not.toContain(" — ");
  });
  it("lists an anchored finding in the body with the inline sentence instead of its detail", () => {
    const r = renderReview(input());
    expect(r.body).toMatch(
      /- \*\*Null deref\*\* `src\/a\.ts:3`\n  Posted inline at the line\. `[0-9a-f]{12}`\n/,
    );
    expect(r.body).not.toContain("x may be undefined");
    expect(r.comments).toHaveLength(1);
  });
  it("keeps the severity group when every finding is anchored", () => {
    const i = input();
    i.result.findings = [i.result.findings[0]!];
    const r = renderReview(i);
    expect(r.body).toContain("#### Must fix");
    expect(r.body).toContain("Posted inline at the line.");
    expect(r.body).not.toContain("#### Should fix");
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
    expect(r.comments[0]!.body.startsWith("**Must fix** · a b")).toBe(true);
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
  it("renders no severity group when there are no findings", () => {
    const i = input();
    i.result.findings = [];
    expect(renderReview(i).body).not.toContain("#### ");
  });
  it("keeps the id inside the bullet when the detail ends with a newline", () => {
    const i = input();
    i.result.findings[1]!.detail = "para one.\n\npara two.\n";
    const r = renderReview(i);
    expect(r.body).toMatch(/  para one\.\n\n  para two\. `[0-9a-f]{12}`\n/);
    expect(r.body).not.toMatch(/\n `[0-9a-f]{12}`/);
  });
  it("passes footer meta through renderReview", () => {
    const r = renderReview({ ...input(), footer: { round: 1, turns: 12 } });
    expect(r.body.trimEnd().endsWith("on the author's own plan · round 1 · 12 turns")).toBe(true);
  });
  it("appends round and turns to the footer when given", () => {
    expect(footerLines("https://x", { round: 2, turns: 31 }).at(-1)).toBe(
      "Reviewed by [Hawkeye](https://x) on the author's own plan · round 2 · 31 turns",
    );
    expect(footerLines("https://x", { round: 1, turns: 1 }).at(-1)).toBe(
      "Reviewed by [Hawkeye](https://x) on the author's own plan · round 1 · 1 turn",
    );
    expect(footerLines("https://x").at(-1)).toBe(
      "Reviewed by [Hawkeye](https://x) on the author's own plan",
    );
  });
  it("says which model was refused when the review ran on the default", () => {
    expect(footerLines("https://x", { round: 1, refusedModel: "claude-fable-5-1" }).at(-1)).toBe(
      "Reviewed by [Hawkeye](https://x) on the author's own plan · round 1 · reviewed on the default model because claude-fable-5-1 was refused",
    );
  });
  it("keeps the lens table on one row per lens", () => {
    const i = input();
    i.result.lenses = i.result.lenses.map((l) =>
      l.name === "intent" ? { ...l, assessment: "line one\nline two | pipe" } : l,
    );
    const r = renderReview(i);
    expect(r.body).toContain("| Intent | line one line two \\| pipe |");
    const lensRows = r.body
      .split("\n")
      .filter((line) => line.startsWith("| ") && line !== "| Lens | Assessment |");
    expect(lensRows).toHaveLength(LENSES.length);
  });
});
