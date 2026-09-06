import { describe, expect, it } from "vitest";
import type { Lens, ReviewResult } from "@hawkeye/core";

const LENSES: Lens[] = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
import { formatDuration, reviewOutcomeLine, reviewProgressLine } from "./review-outcome.js";

const result = (findings: ReviewResult["findings"], verdict: ReviewResult["verdict"]) => ({
  verdict,
  summary: "s",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings,
});

describe("formatDuration", () => {
  it("prints minutes and zero-padded seconds", () => {
    expect(formatDuration(252_000)).toBe("4m 12s");
    expect(formatDuration(14_400)).toBe("0m 14s");
    expect(formatDuration(0)).toBe("0m 00s");
  });
});

describe("reviewOutcomeLine", () => {
  it("names the verdict, the counts and the duration, with must fix only when present", () => {
    const findings: ReviewResult["findings"] = [
      { severity: "must_fix", claim: "a", detail: "d" },
      { severity: "optional", claim: "b", detail: "d" },
    ];
    expect(
      reviewOutcomeLine({ result: result(findings, "blocked"), turns: 6, durationMs: 252_000 }),
    ).toBe("Blocked · 2 findings · 1 must fix · 6 turns · 4m 12s");
    expect(reviewOutcomeLine({ result: result([], "ship"), turns: 1, durationMs: 61_000 })).toBe(
      "Ship · 0 findings · 1 turn · 1m 01s",
    );
  });
  it("styles the verdict and the must-fix count", () => {
    const findings: ReviewResult["findings"] = [{ severity: "must_fix", claim: "a", detail: "d" }];
    expect(
      reviewOutcomeLine({
        result: result(findings, "blocked"),
        turns: 2,
        durationMs: 1000,
        style: { verdict: (text) => `<${text}>`, must: (text) => `[${text}]` },
      }),
    ).toBe("<Blocked> · 1 finding · [1 must fix] · 2 turns · 0m 01s");
  });
});

describe("reviewProgressLine", () => {
  it("names the subject, turns and elapsed time", () => {
    expect(reviewProgressLine({ subject: "octo/repo#7", turns: 4, elapsedMs: 125_000 })).toBe(
      "Reviewing octo/repo#7 · 4 turns · 2m 05s",
    );
  });
});
