import type { PullRequestReference } from "@hawkeye/core";
import { shortenHome } from "./terminal.js";

export function connectedLines(input: {
  runnerName: string | undefined;
  configPath: string;
  home: string;
}): string[] {
  const who = input.runnerName === undefined ? "" : ` as ${input.runnerName}`;
  return [
    `Connected${who}. Token saved to ${shortenHome(input.configPath, input.home)}.`,
    "Start reviewing with: npx hawkeye-review runner",
  ];
}

export function reviewFailedLine(
  message: string,
  emphasize: (text: string) => string = (text) => text,
): string {
  return `${emphasize("Review failed.")} ${message}`;
}

export function alreadyReviewedLines(reference: PullRequestReference, headSha: string): string[] {
  return [
    `${reference.owner}/${reference.repo}#${reference.number} at ${headSha.slice(0, 7)} is already reviewed.`,
    "Run again with --force to review it again.",
  ];
}
