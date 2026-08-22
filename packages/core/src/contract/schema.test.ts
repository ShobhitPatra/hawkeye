import { describe, expect, it } from "vitest";
import { DIMENSIONS, parseReviewResult } from "./schema.js";

const valid = () => ({
  verdict: "needs-work",
  summary: "One bug.",
  dimensions: DIMENSIONS.map((name) => ({ name, assessment: "ok" })),
  findings: [
    {
      path: "src/a.ts",
      line: 3,
      class: "blocking",
      claim: "Null deref",
      detail: "x may be undefined",
    },
  ],
});

describe("parseReviewResult", () => {
  it("accepts a valid result", () => {
    expect(parseReviewResult(valid()).findings).toHaveLength(1);
  });
  it("rejects a missing dimension", () => {
    const r = valid();
    r.dimensions = r.dimensions.slice(1);
    expect(() => parseReviewResult(r)).toThrow(/dimension/);
  });
  it("rejects a duplicated dimension", () => {
    const r = valid();
    r.dimensions[0] = { name: "correctness", assessment: "dup" };
    expect(() => parseReviewResult(r)).toThrow(/dimension/);
  });
  it("rejects an unknown finding class", () => {
    const r = valid();
    (r.findings[0] as { class: string }).class = "nit";
    expect(() => parseReviewResult(r)).toThrow();
  });
  it("rejects a suggestion without a line", () => {
    const r = valid();
    r.findings[0] = {
      path: "a",
      class: "polish",
      claim: "c",
      detail: "d",
      suggestion: "x",
    } as never;
    expect(() => parseReviewResult(r)).toThrow(/suggestion/);
  });
  it("rejects a line without a path", () => {
    const r = valid();
    r.findings[0] = { line: 2, class: "polish", claim: "c", detail: "d" } as never;
    expect(() => parseReviewResult(r)).toThrow(/path/);
  });
});
