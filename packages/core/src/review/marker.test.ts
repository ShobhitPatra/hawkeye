import { describe, expect, it } from "vitest";
import { decodeMarker, encodeMarker } from "./marker.js";

describe("marker", () => {
  it("round-trips a sha", () => {
    const body = `${encodeMarker("abc123")}\n\n## Verdict`;
    expect(decodeMarker(body)).toBe("abc123");
  });
  it("returns undefined when absent", () => {
    expect(decodeMarker("no marker here")).toBeUndefined();
  });
  it("rejects an empty sha", () => {
    expect(() => encodeMarker("")).toThrow();
  });
});
