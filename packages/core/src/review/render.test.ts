import { describe, expect, it } from "vitest";
import { DIMENSIONS, type ReviewResult } from "../contract/schema.js";
import { renderReview } from "./render.js";

const base = (): ReviewResult => ({
  verdict: "needs-work",
  summary: "Mostly fine.",
  dimensions: DIMENSIONS.map((name) => ({ name, assessment: `${name} ok` })),
  findings: [
    {
      path: "src/a.ts",
      line: 3,
      class: "blocking",
      claim: "Null deref",
      detail: "x may be undefined",
      suggestion: "const y = x ?? 0;",
    },
    { path: "src/a.ts", line: 99, class: "polish", claim: "Rename", detail: "too short" },
    { class: "pre_existing", claim: "Global state", detail: "module singleton" },
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
  it("renders the verdict and every dimension row", () => {
    const r = renderReview(input());
    expect(r.body).toContain("**Verdict:** needs-work");
    for (const d of DIMENSIONS) expect(r.body).toContain(`| ${d} |`);
  });
  it("anchors in-diff findings as comments with a suggestion fence", () => {
    const r = renderReview(input());
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
    expect(r.comments[0]!.body).toContain("```suggestion\nconst y = x ?? 0;\n```");
    expect(r.comments[0]!.body).toContain("**blocking**");
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
  it("keeps the dimension table on one row per dimension", () => {
    const i = input();
    i.result.dimensions = i.result.dimensions.map((d) =>
      d.name === "necessity" ? { ...d, assessment: "line one\nline two | pipe" } : d,
    );
    const r = renderReview(i);
    expect(r.body).toContain("| necessity | line one line two \\| pipe |");
    const dimensionRows = r.body
      .split("\n")
      .filter((line) => line.startsWith("| ") && line !== "| Dimension | Assessment |");
    expect(dimensionRows).toHaveLength(DIMENSIONS.length);
  });
});
