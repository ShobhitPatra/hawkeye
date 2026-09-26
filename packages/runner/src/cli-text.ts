import type { PullRequestReference } from "@hawkeye/core";
import { ControlPlaneRequestError } from "./runner/client.js";
import { shortenHome } from "./terminal.js";

type Connected = { runnerName: string | undefined; configPath: string; home: string };

export function connectedLine(input: Connected): string {
  const who = input.runnerName === undefined ? "" : ` as ${input.runnerName}`;
  return `Connected${who}. Token saved to ${shortenHome(input.configPath, input.home)}.`;
}

export function connectedLines(input: Connected): string[] {
  return [connectedLine(input), "Start reviewing with: npx hawkeye-review runner"];
}

export function runnerStoppedLine(error: unknown): string {
  if (error instanceof ControlPlaneRequestError && error.status === 401)
    return "The control plane refused this machine's runner token; it was removed or replaced. Run npx hawkeye-review runner login to connect again.";
  return (error as Error).message;
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
