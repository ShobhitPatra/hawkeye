import type { ReviewTextStyle } from "@hawkeye/core";

const PLAIN: ReviewTextStyle = {
  verdict: (text) => text,
  must: (text) => text,
  dim: (text) => text,
};
const ESC = "\u001b[";

export function terminalStyle(input: {
  isTTY: boolean | undefined;
  env: Record<string, string | undefined>;
}): ReviewTextStyle {
  if (!input.isTTY || input.env.NO_COLOR !== undefined || input.env.TERM === "dumb") return PLAIN;
  return {
    verdict: (text) => `${ESC}1m${text}${ESC}22m`,
    must: (text) => `${ESC}31m${text}${ESC}39m`,
    dim: (text) => `${ESC}2m${text}${ESC}22m`,
  };
}
