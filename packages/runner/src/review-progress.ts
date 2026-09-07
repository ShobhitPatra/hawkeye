import { formatDuration } from "@hawkeye/core";
import type { ProgressLine } from "./terminal.js";

export function reviewProgressLine(input: {
  subject: string;
  turns: number;
  elapsedMs: number;
}): string {
  return `Reviewing ${input.subject} · ${input.turns} turn${input.turns === 1 ? "" : "s"} · ${formatDuration(input.elapsedMs)}`;
}

export type ReviewProgress = {
  log(line: string): void;
  turn(turns: number): void;
  finish(): void;
};

export function reviewProgress(input: {
  progress: ProgressLine;
  stderr(line: string): void;
  subject: string;
  now?: () => number;
  tickMs?: number;
}): ReviewProgress {
  const now = input.now ?? Date.now;
  const startedAt = now();
  let turns = 0;
  let running = true;
  const paint = () => {
    if (running)
      input.progress.update(
        reviewProgressLine({ subject: input.subject, turns, elapsedMs: now() - startedAt }),
      );
  };
  const ticker = setInterval(paint, input.tickMs ?? 1000);
  return {
    log: (line) => {
      input.progress.clear();
      input.stderr(line);
      paint();
    },
    turn: (count) => {
      turns = count;
      paint();
    },
    finish: () => {
      running = false;
      clearInterval(ticker);
      input.progress.clear();
    },
  };
}
