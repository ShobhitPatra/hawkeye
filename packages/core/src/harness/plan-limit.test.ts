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
  it("reads the claude CLI's session and weekly limits", () => {
    expect(planLimitIn("claude exited with 1: You've hit your session limit · resets 3pm")).toBe(
      "rate limit",
    );
    expect(planLimitIn("claude exited with 1: You've hit your weekly limit")).toBe("rate limit");
  });
  it("reads Codex's usage limit, quota and retry limit", () => {
    expect(
      planLimitIn(
        "codex exited with 1: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at 3:42 PM.",
      ),
    ).toBe("rate limit");
    expect(
      planLimitIn("codex exited with 1: Quota exceeded. Check your plan and billing details."),
    ).toBe("rate limit");
    expect(
      planLimitIn("codex exited with 1: exceeded retry limit, last status: 429 Too Many Requests"),
    ).toBe("rate limit");
  });
  it("reads an overload", () => {
    expect(
      planLimitIn(
        'claude exited with 1: API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}',
      ),
    ).toBe("overload");
    expect(planLimitIn("claude exited with 1: Repeated 529 Overloaded errors")).toBe("overload");
    expect(
      planLimitIn(
        "claude exited with 1: Server is temporarily limiting requests (not your usage limit)",
      ),
    ).toBe("overload");
  });
  it("reads Codex's model at capacity", () => {
    expect(
      planLimitIn(
        "codex exited with 1: Selected model is at capacity. Please try a different model.",
      ),
    ).toBe("overload");
  });
  it("reads nothing from other failures", () => {
    expect(planLimitIn("claude exited with 1: line 429 of file.ts")).toBeUndefined();
    expect(planLimitIn("stopped without a message")).toBeUndefined();
    expect(
      planLimitIn("EDQUOT: disk quota exceeded, mkdir '/home/u/.cache/hawkeye/runs/x'"),
    ).toBeUndefined();
  });
});
