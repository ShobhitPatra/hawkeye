import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_WINDOW_SECONDS, quietWindowSeconds } from "./quiet-window";

describe("quietWindowSeconds", () => {
  it("falls back to the default without settings or an override", () => {
    expect(quietWindowSeconds(undefined, { quietWindowSeconds: null })).toBe(
      DEFAULT_QUIET_WINDOW_SECONDS,
    );
  });

  it("uses the user setting when the armed pull request has no override", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 30 }, { quietWindowSeconds: null })).toBe(30);
  });

  it("prefers the armed pull request override", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 30 }, { quietWindowSeconds: 5 })).toBe(5);
  });

  it("honours a zero override", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 30 }, { quietWindowSeconds: 0 })).toBe(0);
  });

  it("honours a zero user setting", () => {
    expect(quietWindowSeconds({ quietWindowSeconds: 0 }, { quietWindowSeconds: null })).toBe(0);
  });
});
