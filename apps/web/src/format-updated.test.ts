import { describe, expect, it } from "vitest";
import { formatUpdated } from "./format-updated";

const now = Date.parse("2026-08-23T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatUpdated", () => {
  it("picks the largest unit that fits", () => {
    expect(formatUpdated(ago(2 * 365 * 24 * 60 * 60 * 1000), now)).toBe("2 years ago");
    expect(formatUpdated(ago(45 * 24 * 60 * 60 * 1000), now)).toBe("last month");
    expect(formatUpdated(ago(3 * 24 * 60 * 60 * 1000), now)).toBe("3 days ago");
    expect(formatUpdated(ago(5 * 60 * 60 * 1000), now)).toBe("5 hours ago");
    expect(formatUpdated(ago(2 * 60 * 1000), now)).toBe("2 minutes ago");
  });
  it("falls back to seconds and handles future times", () => {
    expect(formatUpdated(ago(20 * 1000), now)).toBe("20 seconds ago");
    expect(formatUpdated(new Date(now + 2 * 60 * 60 * 1000).toISOString(), now)).toBe("in 2 hours");
  });
});
