import { describe, expect, it } from "vitest";
import { decodeFindingMarker, decodeMarker, encodeFindingMarker, encodeMarker } from "./marker.js";

describe("marker", () => {
  it("round-trips a sha", () => {
    const body = `${encodeMarker("abc123")}\n\n## Verdict`;
    expect(decodeMarker(body)).toBe("abc123");
  });
  it("returns undefined when absent", () => {
    expect(decodeMarker("no marker here")).toBeUndefined();
  });
  it("round-trips a finding id on an inline comment", () => {
    const body = `**Must fix** · x\n\n${encodeFindingMarker("abc123def456")}`;
    expect(decodeFindingMarker(body)).toBe("abc123def456");
    expect(decodeFindingMarker("plain")).toBeUndefined();
    expect(() => encodeFindingMarker("")).toThrow();
  });
  it("rejects an empty sha", () => {
    expect(() => encodeMarker("")).toThrow();
  });
});
