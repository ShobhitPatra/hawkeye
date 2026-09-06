import { describe, expect, it, vi } from "vitest";
import { reviewProgress, reviewProgressLine } from "./review-progress.js";

describe("reviewProgressLine", () => {
  it("names the subject, turns and elapsed time", () => {
    expect(reviewProgressLine({ subject: "octo/repo#7", turns: 4, elapsedMs: 125_000 })).toBe(
      "Reviewing octo/repo#7 · 4 turns · 2m 05s",
    );
  });
});

describe("reviewProgress", () => {
  it("clears the line before a log line, repaints after, and stops repainting once finished", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const progress = {
      update: (text: string) => writes.push(`update:${text}`),
      clear: () => writes.push("clear"),
    };
    const stderr = (line: string) => writes.push(`stderr:${line}`);
    let clock = 0;
    const control = reviewProgress({ progress, stderr, subject: "octo/repo#7", now: () => clock });
    control.log("run directory: /r");
    clock = 12_000;
    control.turn(3);
    control.log("turn 3");
    control.finish();
    control.log("error: boom");
    vi.advanceTimersByTime(3000);
    expect(writes).toEqual([
      "clear",
      "stderr:run directory: /r",
      "update:Reviewing octo/repo#7 · 0 turns · 0m 00s",
      "update:Reviewing octo/repo#7 · 3 turns · 0m 12s",
      "clear",
      "stderr:turn 3",
      "update:Reviewing octo/repo#7 · 3 turns · 0m 12s",
      "clear",
      "clear",
      "stderr:error: boom",
    ]);
    vi.useRealTimers();
  });
  it("repaints on every tick while running", () => {
    vi.useFakeTimers();
    const update = vi.fn();
    const control = reviewProgress({
      progress: { update, clear: () => {} },
      stderr: () => {},
      subject: "octo/repo#7",
      tickMs: 1000,
    });
    vi.advanceTimersByTime(2500);
    expect(update).toHaveBeenCalledTimes(2);
    control.finish();
    vi.advanceTimersByTime(2000);
    expect(update).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
