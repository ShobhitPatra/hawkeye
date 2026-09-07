import type { ReviewTextStyle } from "@hawkeye/core";

export type TerminalStyle = ReviewTextStyle & { warn(text: string): string };

const PLAIN: TerminalStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
  warn: (text) => text,
};
const ESC = "\u001b[";

export function terminalStyle(input: {
  isTTY: boolean | undefined;
  env: Record<string, string | undefined>;
}): TerminalStyle {
  if (!input.isTTY || input.env.NO_COLOR !== undefined || input.env.TERM === "dumb") return PLAIN;
  return {
    verdict: (text) => `${ESC}1m${text}${ESC}22m`,
    must: (text) => `${ESC}31m${text}${ESC}39m`,
    dim: (text) => `${ESC}2m${text}${ESC}22m`,
    warn: (text) => `${ESC}33m${text}${ESC}39m`,
  };
}

export type ProgressLine = { update(text: string): void; clear(): void };

export function progressLine(input: {
  isTTY: boolean | undefined;
  write(text: string): void;
}): ProgressLine {
  if (!input.isTTY) return { update: () => {}, clear: () => {} };
  const erase = `\r${ESC}2K`;
  return {
    update: (text) => input.write(`${erase}${text}`),
    clear: () => input.write(erase),
  };
}
