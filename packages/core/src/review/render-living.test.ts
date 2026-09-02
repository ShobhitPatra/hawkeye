import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import { renderLivingReview } from "./render-living.js";

const head = "b".repeat(40);
const result = (): ReviewResult => ({
  verdict: "changes_needed",
  summary: "Round two.",
  lenses: LENSES.map((name) => ({ name, assessment: `${name} ok` })),
  findings: [
    { path: "src/a.ts", line: 3, severity: "must_fix", claim: "New bug", detail: "broken" },
    { path: "src/a.ts", line: 4, severity: "should_fix", claim: "Old bug", detail: "still there" },
  ],
  priorFindings: [
    { id: findingId("src/a.ts", "Old bug"), status: "open", note: "still unaddressed" },
    { id: findingId("src/b.ts", "Fixed bug"), status: "addressed", note: "fixed\nin c2" },
  ],
});
const rounds = [
  { round: 1, headSha: "a".repeat(40), verdict: "changes_needed", startedAt: "2026-01-01" },
  { round: 2, headSha: head, verdict: "ship", startedAt: "2026-01-02" },
];
const input = (previousIds = new Set([findingId("src/a.ts", "Old bug")])) => ({
  result: result(),
  headSha: head,
  commentable: new Map([["src/a.ts", new Set([3, 4])]]),
  repositoryUrl: "https://github.com/ShobhitPatra/hawkeye",
  previousIds,
  priorClaims: { [findingId("src/b.ts", "Fixed bug")]: "Fixed\nbug" },
  rounds,
});

describe("renderLivingReview", () => {
  it("orders marker, verdict, findings, prior findings, rounds and footer", () => {
    const r = renderLivingReview(input());
    expect(r.body.startsWith(`<!-- hawkeye: head=${head} -->`)).toBe(true);
    const verdict = r.body.indexOf("# <small>Verdict:</small> **CHANGES NEEDED**");
    const findings = r.body.indexOf("## Findings");
    const prior = r.body.indexOf("### Prior findings");
    const roundsAt = r.body.indexOf("### Rounds");
    const footer = r.body.indexOf("Reviewed by [Hawkeye]");
    expect(verdict).toBeGreaterThan(0);
    expect(verdict).toBeLessThan(findings);
    expect(findings).toBeLessThan(prior);
    expect(prior).toBeLessThan(roundsAt);
    expect(roundsAt).toBeLessThan(footer);
    expect(r.body.trimEnd().endsWith("on the author's own plan.")).toBe(true);
  });
  it("comments only on findings that are new this round and anchored", () => {
    const r = renderLivingReview(input());
    expect(r.comments).toHaveLength(1);
    expect(r.comments[0]).toMatchObject({ path: "src/a.ts", line: 3, side: "RIGHT" });
    expect(r.comments[0]!.body).toContain("New bug");
  });
  it("lists a repeated anchored finding in the body with its detail, not inline", () => {
    const r = renderLivingReview(input());
    expect(r.body).toContain("**Old bug**");
    expect(r.body).toContain("still there");
    expect(r.body).not.toContain("**Old bug** — `src/a.ts:4` (inline)");
  });
  it("comments on nothing when every finding was already in the previous round", () => {
    const all = new Set([findingId("src/a.ts", "New bug"), findingId("src/a.ts", "Old bug")]);
    const r = renderLivingReview(input(all));
    expect(r.comments).toEqual([]);
    expect(r.body).toContain("broken");
  });
  it("skips unanchored new findings in the comments", () => {
    const i = input(new Set<string>());
    i.commentable = new Map();
    const r = renderLivingReview(i);
    expect(r.comments).toEqual([]);
  });
  it("renders one prior finding line with status, claim and note on one line", () => {
    const r = renderLivingReview(input());
    const openId = findingId("src/a.ts", "Old bug");
    const addressedId = findingId("src/b.ts", "Fixed bug");
    expect(r.body).toContain(`- [${openId}] open · Old bug · still unaddressed`);
    expect(r.body).toContain(`- [${addressedId}] addressed · Fixed bug · fixed in c2`);
  });
  it("omits the prior findings section when the result reports none", () => {
    const i = input();
    delete i.result.priorFindings;
    expect(renderLivingReview(i).body).not.toContain("### Prior findings");
  });
  it("renders the rounds table with short heads and spaced verdicts", () => {
    const r = renderLivingReview(input());
    expect(r.body).toContain("| Round | Head | Verdict | Started |");
    expect(r.body).toContain(`| 1 | \`${"a".repeat(7)}\` | changes needed | 2026-01-01 |`);
    expect(r.body).toContain(`| 2 | \`${"b".repeat(7)}\` | ship | 2026-01-02 |`);
  });
  it("keeps the collapsed lens table in the living body", () => {
    const { body } = renderLivingReview(input());
    expect(body).toContain("<summary>Review lenses</summary>");
    expect(body.indexOf("Review lenses")).toBeLessThan(body.indexOf("Reviewed by"));
  });
});
