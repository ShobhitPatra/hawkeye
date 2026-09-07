import { renderReviewOutcomeLine } from "@hawkeye/core";
import { join } from "node:path";
import type { TerminalStyle } from "../terminal.js";
import type { RunnerEvent } from "./loop.js";

export type ConsoleEvent =
  | RunnerEvent
  | { state: "polling" | "contract" | "stopping"; detail: string };

const STATE_WIDTH = 10;
const PLAIN: TerminalStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
  warn: (text) => text,
};

export function shortenHome(text: string, home: string): string {
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|\\s)${escaped}(?=/|$)`, "g"), "$1~");
}

export function runnerConsole(input: {
  stderr(line: string): void;
  appendFile(path: string, line: string): void;
  home: string;
  style?: Partial<TerminalStyle>;
  now?: () => Date;
}): { report(event: ConsoleEvent): void; log(line: string): void } {
  const style = { ...PLAIN, ...input.style };
  const now = input.now ?? (() => new Date());
  let logPath: string | undefined;
  const word = (state: string) => {
    const padded = state.padEnd(STATE_WIDTH);
    if (state === "failed") return style.must(padded);
    if (state === "waiting") return style.warn(padded);
    return padded;
  };
  const detailOf = (event: ConsoleEvent): string => {
    switch (event.state) {
      case "claimed":
        return `${event.subject} at ${event.headSha.slice(0, 7)}`;
      case "reviewing":
        return shortenHome(event.runDirectory, input.home);
      case "posted":
        return renderReviewOutcomeLine({
          result: event.result,
          turns: event.turns,
          durationMs: event.durationMs,
          style,
        });
      default:
        return shortenHome(event.detail, input.home);
    }
  };
  return {
    report: (event) => {
      if (event.state === "reviewing") logPath = join(event.runDirectory, "log.txt");
      const time = now().toTimeString().slice(0, 8);
      input.stderr(`${style.dim(time)}  ${word(event.state)} ${detailOf(event)}`);
    },
    log: (line) => {
      if (logPath === undefined) input.stderr(line);
      else input.appendFile(logPath, `${line}\n`);
    },
  };
}
