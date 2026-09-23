import { describe, expect, it } from "vitest";
import { planLimitIn } from "./plan-limit.js";

describe("planLimitIn", () => {
  it("reads a rate limit from the CLI's API error line", () => {
    expect(
      planLimitIn(
        'claude exited with 1: API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}',
      ),
    ).toBe("rate limit");
  });
  it("reads a plan usage limit", () => {
    expect(planLimitIn("claude exited with 1: Claude usage limit reached. Resets at 3pm")).toBe(
      "rate limit",
    );
  });
  it("reads an overload", () => {
    expect(
      planLimitIn(
        'claude exited with 1: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}',
      ),
    ).toBe("overload");
  });
  it("reads nothing from other failures", () => {
    expect(planLimitIn("claude exited with 1: line 429 of file.ts")).toBeUndefined();
    expect(planLimitIn("stopped without a message")).toBeUndefined();
  });
});
