import { describe, expect, it } from "vitest";
import { LENSES, parseReviewResult } from "./schema.js";

const valid = () => ({
  verdict: "revise",
  summary: "One bug.",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [
    {
      path: "src/a.ts",
      line: 3,
      severity: "must_fix",
      claim: "Null deref",
      detail: "x may be undefined",
    },
  ],
});

describe("parseReviewResult", () => {
  it("accepts a valid result", () => {
    expect(parseReviewResult(valid()).findings).toHaveLength(1);
  });
  it("rejects a missing lens", () => {
    const r = valid();
    r.lenses = r.lenses.slice(1);
    expect(() => parseReviewResult(r)).toThrow(/lens/);
  });
  it("rejects a duplicated lens", () => {
    const r = valid();
    r.lenses[0] = { name: "behavior", assessment: "dup" };
    expect(() => parseReviewResult(r)).toThrow(/lens/);
  });
  it("rejects an unknown finding severity", () => {
    const r = valid();
    (r.findings[0] as { severity: string }).severity = "nit";
    expect(() => parseReviewResult(r)).toThrow();
  });
  it("rejects an unknown verdict", () => {
    const r = valid();
    r.verdict = "needs-work";
    expect(() => parseReviewResult(r)).toThrow();
  });
  it("rejects a suggestion without a line", () => {
    const r = valid();
    r.findings[0] = {
      path: "a",
      severity: "should_fix",
      claim: "c",
      detail: "d",
      suggestion: "x",
    } as never;
    expect(() => parseReviewResult(r)).toThrow(/suggestion/);
  });
  it("rejects a line without a path", () => {
    const r = valid();
    r.findings[0] = { line: 2, severity: "should_fix", claim: "c", detail: "d" } as never;
    expect(() => parseReviewResult(r)).toThrow(/path/);
  });
});
