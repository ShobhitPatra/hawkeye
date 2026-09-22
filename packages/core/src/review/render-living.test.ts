import { describe, expect, it } from "vitest";
import { LENSES, type ReviewResult } from "../contract/schema.js";
import { findingId } from "./finding-id.js";
import {
  LIVING_REVIEW_BODY_BUDGET,
  renderLivingReview,
  renderMinimalLivingReview,
} from "./render-living.js";
import type { RoundSummary } from "./render-text.js";

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
const rounds: RoundSummary[] = [
  {
    round: 1,
    headSha: "a".repeat(40),
    verdict: "changes_needed",
    startedAt: "2026-01-01",
  },
  { round: 2, headSha: head, verdict: "ship", startedAt: "2026-01-02", turns: 31 },
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
    const verdict = r.body.indexOf("### Changes needed");
    const findings = r.body.indexOf("#### Must fix");
    const prior = r.body.indexOf("#### Prior findings");
    const roundsAt = r.body.indexOf("<summary>Rounds</summary>");
    const footer = r.body.indexOf("Reviewed by [Hawkeye]");
    expect(verdict).toBeGreaterThan(0);
    expect(verdict).toBeLessThan(findings);
    expect(findings).toBeLessThan(prior);
    expect(prior).toBeLessThan(roundsAt);
    expect(roundsAt).toBeLessThan(footer);
    expect(r.body.trimEnd().endsWith("on the author's own plan · round 2 · 31 turns")).toBe(true);
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
    expect(r.body).not.toContain("**Old bug** `src/a.ts:4`\n  Posted inline");
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
    expect(r.body).toContain(`- \`${openId}\` open · Old bug · still unaddressed`);
    expect(r.body).toContain(`- \`${addressedId}\` addressed · Fixed bug · fixed in c2`);
  });
  it("omits the prior findings section when the result reports none", () => {
    const i = input();
    delete i.result.priorFindings;
    expect(renderLivingReview(i).body).not.toContain("Prior findings");
  });
  it("collapses the rounds table with short heads and verdict labels", () => {
    const r = renderLivingReview(input());
    expect(r.body).toContain(
      "<details>\n<summary>Rounds</summary>\n\n| Round | Head | Verdict | Started |",
    );
    expect(r.body).toContain(`| 1 | \`${"a".repeat(7)}\` | Changes needed | 2026-01-01 |`);
    expect(r.body).toContain(`| 2 | \`${"b".repeat(7)}\` | Ship | 2026-01-02 |`);
  });
  it("capitalizes pending and invalid rounds like the verdict labels", () => {
    const i = input();
    i.rounds = [
      { round: 1, headSha: "c".repeat(40), verdict: "invalid", startedAt: "2026-01-01" },
      { round: 2, headSha: head, verdict: "pending", startedAt: "2026-01-02" },
    ];
    const { body } = renderLivingReview(i);
    expect(body).toContain(`| 1 | \`${"c".repeat(7)}\` | Invalid | 2026-01-01 |`);
    expect(body).toContain(`| 2 | \`${"b".repeat(7)}\` | Pending | 2026-01-02 |`);
  });
  it("names the refused model in the footer of the current round", () => {
    const i = input();
    i.rounds = i.rounds.map((round) =>
      round.headSha === i.headSha ? { ...round, refusedModel: "claude-fable-5-1" } : round,
    );
    expect(
      renderLivingReview(i)
        .body.trimEnd()
        .endsWith("reviewed on the default model because claude-fable-5-1 was refused"),
    ).toBe(true);
  });

  it("leaves round and turns off the footer when the current head has no round", () => {
    const i = input();
    i.rounds = [];
    expect(renderLivingReview(i).body.trimEnd().endsWith("on the author's own plan")).toBe(true);
  });
  it("keeps the collapsed lens table in the living body", () => {
    const { body } = renderLivingReview(input());
    expect(body).toContain("<summary>Review lenses</summary>");
    expect(body.indexOf("Review lenses")).toBeLessThan(body.indexOf("Reviewed by"));
  });

  it("reports nothing trimmed for a body within the budget", () => {
    const rendered = renderLivingReview(input());
    expect(rendered.trimmed).toEqual([]);
    expect(rendered.body.length).toBeLessThan(LIVING_REVIEW_BODY_BUDGET);
  });

  it("drops the oldest rounds and the closed prior findings first, keeping the open ones", () => {
    const many: RoundSummary[] = Array.from({ length: 400 }, (_, index) => ({
      round: index + 1,
      headSha: index === 399 ? head : index.toString(16).padStart(40, "0"),
      verdict: "changes_needed",
      startedAt: "2026-01-01 00:00 UTC",
    }));
    const base = input();
    const closed = Array.from({ length: 300 }, (_, index) => ({
      id: `closed-${index}`,
      status: "addressed" as const,
      note: "fixed ".repeat(30),
    }));
    const rendered = renderLivingReview({
      ...base,
      rounds: many,
      result: { ...base.result, priorFindings: [...base.result.priorFindings!, ...closed] },
      maxBodyLength: 6_000,
    });
    expect(rendered.body.length).toBeLessThanOrEqual(6_000);
    expect(rendered.trimmed).toEqual(["older rounds", "closed prior findings"]);
    expect(rendered.body).toContain("| 390 earlier rounds | | | |");
    expect(rendered.body).toContain("| 400 |");
    expect(rendered.body).not.toContain("| 390 |");
    expect(rendered.body).toContain("301 closed prior findings not shown.");
    expect(rendered.body).toContain("still unaddressed");
    expect(rendered.body).toContain("### Changes needed");
    expect(rendered.body).toContain("Review lenses");
    expect(rendered.body).toContain("round 400");
  });

  it("shrinks findings to their claims, least severe first, and never loses a claim", () => {
    const base = input(new Set());
    const long = "x".repeat(3_000);
    const findings = [
      { path: "src/m.ts", severity: "must_fix" as const, claim: "Must claim", detail: long },
      { path: "src/s.ts", severity: "should_fix" as const, claim: "Should claim", detail: long },
      { path: "src/o.ts", severity: "optional" as const, claim: "Optional claim", detail: long },
    ];
    const rendered = renderLivingReview({
      ...base,
      commentable: new Map(),
      result: { ...base.result, findings, priorFindings: [] },
      maxBodyLength: 5_500,
    });
    expect(rendered.trimmed.at(-1)).toBe("should fix finding detail");
    expect(rendered.body).toContain(
      `- **Optional claim** \`src/o.ts\` \`${findingId("src/o.ts", "Optional claim")}\``,
    );
    expect(rendered.body).toContain("**Should claim**");
    expect(rendered.body).toContain(long);
    expect(rendered.body.match(/x{3000}/g)).toHaveLength(1);
    expect(rendered.body).not.toContain("Review lenses");
  });

  it("walks each later rung alone: the current round, the lens table, then every detail", () => {
    const base = input(new Set());
    const many: RoundSummary[] = Array.from({ length: 12 }, (_, index) => ({
      round: index + 1,
      headSha: index === 11 ? head : index.toString(16).padStart(40, "0"),
      verdict: "ship",
      startedAt: "2026-01-01 00:00 UTC",
    }));
    const must = { path: "src/m.ts", severity: "must_fix" as const, claim: "Must claim" };
    const sized = (detail: string, maxBodyLength: number) =>
      renderLivingReview({
        ...base,
        commentable: new Map(),
        rounds: many,
        result: { ...base.result, findings: [{ ...must, detail }], priorFindings: [] },
        maxBodyLength,
      });
    const full = sized("short", 100_000).body.length;
    const rowLength = 56;

    const currentOnly = sized("short", full - 3 * rowLength);
    expect(currentOnly.trimmed.at(-1)).toBe("all but the current round");
    expect(currentOnly.body).toContain("| 11 earlier rounds | | | |");
    expect(currentOnly.body).toContain("Review lenses");

    const noLenses = sized("short", currentOnly.body.length - 1);
    expect(noLenses.trimmed.at(-1)).toBe("the lens table");
    expect(noLenses.body).not.toContain("Review lenses");
    expect(noLenses.body).toContain("  short");

    const long = "y".repeat(4_000);
    const claimsOnly = sized(long, 3_000);
    expect(claimsOnly.trimmed.at(-1)).toBe("every finding's detail");
    expect(claimsOnly.body).not.toContain(long);
    expect(claimsOnly.body).toContain(
      `- **Must claim** \`src/m.ts\` \`${findingId("src/m.ts", "Must claim")}\``,
    );
    expect(claimsOnly.body).toContain("### Changes needed");
  });

  it("caps the summary in the short form so it cannot be refused for length", () => {
    const base = input(new Set());
    const body = renderMinimalLivingReview({
      ...base,
      result: { ...base.result, summary: "z".repeat(90_000) },
    });
    expect(body.length).toBeLessThan(4_000);
    expect(body).toContain(`${"z".repeat(2_000)}…`);
    expect(body).toContain("### Changes needed");
  });

  it("names only the rungs that removed something", () => {
    const base = input(new Set());
    const long = "w".repeat(4_000);
    const rendered = renderLivingReview({
      ...base,
      commentable: new Map(),
      result: {
        ...base.result,
        findings: [
          { path: "src/o.ts", severity: "optional", claim: "Optional claim", detail: long },
        ],
        priorFindings: [],
      },
      maxBodyLength: 3_000,
    });
    expect(rendered.trimmed).toEqual([
      "all but the current round",
      "the lens table",
      "optional finding detail",
    ]);
  });

  it("uses the singular for one earlier round and one closed prior finding", () => {
    const base = input(new Set());
    const eleven: RoundSummary[] = Array.from({ length: 11 }, (_, index) => ({
      round: index + 1,
      headSha: index === 10 ? head : index.toString(16).padStart(40, "0"),
      verdict: "changes_needed",
      startedAt: "2026-01-01 00:00 UTC",
    }));
    const justOver = (over: Parameters<typeof renderLivingReview>[0]) =>
      renderLivingReview({ ...over, maxBodyLength: renderLivingReview(over).body.length - 1 });

    const oneRound = justOver({ ...base, rounds: eleven });
    expect(oneRound.trimmed).toEqual(["older rounds"]);
    expect(oneRound.body).toContain("| 1 earlier round | | | |");

    const onePrior = justOver(base);
    expect(onePrior.trimmed).toEqual(["closed prior findings"]);
    expect(onePrior.body).toContain("- 1 closed prior finding not shown.");
  });

  it("says there are no findings in the short form of a clean review", () => {
    const base = input(new Set());
    const body = renderMinimalLivingReview({
      ...base,
      result: { ...base.result, verdict: "ship", findings: [] },
    });
    expect(body).toContain("### Ship");
    expect(body).toContain("No findings.");
    expect(body).not.toContain("Findings:");
  });

  it("falls back to the short form when even the claims do not fit", () => {
    const base = input(new Set());
    const rendered = renderLivingReview({ ...base, maxBodyLength: 400 });
    expect(rendered.trimmed.at(-1)).toBe("the findings list");
    expect(rendered.body).toBe(renderMinimalLivingReview(base));
    expect(rendered.body).toContain("### Changes needed");
    expect(rendered.body).toContain("Findings: 1 must fix, 1 should fix.");
    expect(rendered.body).toContain("too long for GitHub to accept in full");
    expect(rendered.body).toContain("round 2");
  });
});
