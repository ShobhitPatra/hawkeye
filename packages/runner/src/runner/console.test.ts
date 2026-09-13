import { describe, expect, it } from "vitest";
import type { Lens, ReviewResult } from "@hawkeye/core";
import { runnerConsole } from "./console.js";

const LENSES: Lens[] = ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"];
const result: ReviewResult = {
  verdict: "blocked",
  summary: "s",
  lenses: LENSES.map((name) => ({ name, assessment: "ok" })),
  findings: [{ severity: "must_fix", claim: "a", detail: "d" }],
};

function console(style?: Parameters<typeof runnerConsole>[0]["style"]) {
  const lines: string[] = [];
  const files: Record<string, string> = {};
  const created = runnerConsole({
    stderr: (line) => lines.push(line),
    appendFile: (path, text) => {
      files[path] = (files[path] ?? "") + text;
    },
    home: "/home/u",
    now: () => new Date(2026, 8, 6, 10, 6, 43),
    ...(style === undefined ? {} : { style }),
  });
  return { ...created, lines, files };
}

describe("runnerConsole", () => {
  it("prints time, a state word in a fixed column and the subject", () => {
    const c = console();
    c.report({ state: "polling", detail: "https://hawkeye.review" });
    c.report({ state: "claimed", subject: "o/r#7", headSha: "a".repeat(40) });
    c.report({ state: "reviewing", runDirectory: "/home/u/.cache/hawkeye/runs/1" });
    c.report({ state: "posted", result, turns: 6, durationMs: 252_000 });
    c.report({ state: "failed", detail: "claude exited 1 after 2 turns · run kept in /home/u/r" });
    c.report({ state: "idle", detail: "no job queued" });
    expect(c.lines).toEqual([
      "10:06:43  polling    https://hawkeye.review",
      "10:06:43  claimed    o/r#7 at aaaaaaa",
      "10:06:43  reviewing  ~/.cache/hawkeye/runs/1",
      "10:06:43  posted     Blocked · 1 finding · 1 must fix · 6 turns · 4m 12s",
      "10:06:43  failed     claude exited 1 after 2 turns · run kept in ~/r",
      "10:06:43  idle       no job queued",
    ]);
  });
  it("prefixes the slot when a job carries one and logs into that job's run directory", () => {
    const c = console();
    c.report({ state: "claimed", subject: "o/r#7", headSha: "a".repeat(40), slot: 2 });
    c.report({ state: "reviewing", runDirectory: "/home/u/runs/2", slot: 2 });
    c.log("turn 1", "/home/u/runs/1");
    c.log("turn 1", "/home/u/runs/2");
    expect(c.lines).toEqual([
      "10:06:43  claimed    [2] o/r#7 at aaaaaaa",
      "10:06:43  reviewing  [2] ~/runs/2",
    ]);
    expect(c.files).toEqual({
      "/home/u/runs/1/log.txt": "turn 1\n",
      "/home/u/runs/2/log.txt": "turn 1\n",
    });
  });

  it("colors only the time, the failed and waiting words and the verdict", () => {
    const c = console({
      dim: (text) => `<d>${text}</d>`,
      must: (text) => `<r>${text}</r>`,
      warn: (text) => `<y>${text}</y>`,
      verdict: (text) => `<b>${text}</b>`,
    });
    c.report({ state: "waiting", detail: "result not sent (x); retrying in 2s" });
    c.report({ state: "failed", detail: "boom" });
    c.report({ state: "posted", result, turns: 1, durationMs: 1000 });
    expect(c.lines).toEqual([
      "<d>10:06:43</d>  <y>waiting   </y> result not sent (x); retrying in 2s",
      "<d>10:06:43</d>  <r>failed    </r> boom",
      "<d>10:06:43</d>  posted     <b>Blocked</b> · 1 finding · <r>1 must fix</r> · 1 turn · 0m 01s",
    ]);
  });
  it("sends detail lines to the run's log file once a run directory is known", () => {
    const c = console();
    c.log("before any run");
    c.report({ state: "reviewing", runDirectory: "/home/u/r" });
    c.log("turn 1");
    c.log("turn 2");
    expect(c.lines).toEqual(["before any run", "10:06:43  reviewing  ~/r"]);
    expect(c.files).toEqual({ "/home/u/r/log.txt": "turn 1\nturn 2\n" });
  });
});
