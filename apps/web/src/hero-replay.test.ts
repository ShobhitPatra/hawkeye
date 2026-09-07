import { describe, expect, it } from "vitest";
import { chunkEnds, HERO_ACTS } from "./hero-replay";

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
    expect(HERO_ACTS.machine).toBeLessThan(HERO_ACTS.reviewing);
    expect(HERO_ACTS.reviewing).toBeLessThan(HERO_ACTS.posted);
  });
});
