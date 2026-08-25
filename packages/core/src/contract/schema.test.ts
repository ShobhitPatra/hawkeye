import { describe, expect, it } from "vitest";
import { LENSES, SEVERITIES, VERDICTS, parseReviewResult, verdictFor } from "./schema.js";

const valid = () => ({
  verdict: "changes_needed",
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
  it("accepts every severity", () => {
    expect(SEVERITIES).toContain("optional");
    for (const severity of SEVERITIES) {
      const r = valid();
      r.findings[0]!.severity = severity;
      expect(parseReviewResult(r).findings[0]!.severity).toBe(severity);
    }
  });
  it("accepts every verdict on the wire and derives the stored one from the findings", () => {
    for (const verdict of VERDICTS) {
      const r = valid();
      r.verdict = verdict;
      expect(parseReviewResult(r).verdict).toBe("blocked");
    }
  });
  it("derives the verdict from the worst finding", () => {
    const finding = (severity: string) => ({ ...valid().findings[0]!, severity }) as never;
    expect(verdictFor([])).toBe("ship");
    expect(verdictFor([finding("inherited")])).toBe("mergeable");
    expect(verdictFor([finding("optional"), finding("inherited")])).toBe("mergeable");
    expect(verdictFor([finding("optional"), finding("should_fix")])).toBe("changes_needed");
    expect(verdictFor([finding("should_fix"), finding("must_fix")])).toBe("blocked");
  });
  it("keeps what the model reported beside the derived verdict", () => {
    const r = valid();
    r.verdict = "ship";
    const parsed = parseReviewResult(r);
    expect(parsed.verdict).toBe("blocked");
    expect(parsed.reportedVerdict).toBe("ship");
  });
  it("still accepts the legacy verdicts on the wire and maps them", () => {
    const r = valid();
    r.findings = [];
    r.verdict = "revise";
    expect(parseReviewResult(r)).toMatchObject({
      verdict: "ship",
      reportedVerdict: "changes_needed",
    });
    r.verdict = "hold";
    expect(parseReviewResult(r)).toMatchObject({ verdict: "ship", reportedVerdict: "blocked" });
  });
  it("rejects an unknown verdict", () => {
    const r = valid();
    r.verdict = "needs-work";
    expect(() => parseReviewResult(r)).toThrow();
  });
  it("accepts a finding with a rationale", () => {
    const r = valid();
    (r.findings[0] as { rationale?: string }).rationale =
      "Trace shows x is null on the retry path.";
    expect(parseReviewResult(r).findings[0]!.rationale).toBe(
      "Trace shows x is null on the retry path.",
    );
  });
  it("accepts a finding without a rationale", () => {
    expect(parseReviewResult(valid()).findings[0]!.rationale).toBeUndefined();
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
