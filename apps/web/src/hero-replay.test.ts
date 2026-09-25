import { describe, expect, it } from "vitest";
import { chunkEnds, HERO_ACTS } from "./hero-replay";
import { LANDING_REVIEW } from "./landing-review";

describe("chunkEnds", () => {
  it("splits a length into even chunk ends that reach the full length", () => {
    expect(chunkEnds(60, 28)).toEqual([20, 40, 60]);
    expect(chunkEnds(5, 28)).toEqual([5]);
    expect(chunkEnds(0, 28)).toEqual([0]);
  });
  it("rejects a chunk size that is not a positive integer", () => {
    expect(() => chunkEnds(10, 0)).toThrow("chunk must be a positive integer");
  });
});

describe("HERO_ACTS", () => {
  it("runs the acts in order", () => {
    expect(HERO_ACTS.chip).toBeLessThan(HERO_ACTS.machine);
    expect(HERO_ACTS.machine).toBeLessThan(HERO_ACTS.reviewing);
    expect(HERO_ACTS.reviewing).toBeLessThan(HERO_ACTS.posted);
  });
  it("leaves every terminal line and the chip on screen for at least a second", () => {
    const lastLine = Math.max(...LANDING_REVIEW.terminal.map((line) => line.delayMs));
    expect(HERO_ACTS.machine + lastLine + 1000).toBeLessThanOrEqual(HERO_ACTS.reviewing);
    expect(HERO_ACTS.chip + 1000).toBeLessThanOrEqual(HERO_ACTS.machine);
    expect(HERO_ACTS.reviewing + 1000).toBeLessThanOrEqual(HERO_ACTS.posted);
  });
});
