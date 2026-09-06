import type { GitHubClient, PullRequestReference } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { run } from "./db/schema";

const OPEN = "<!-- hawkeye: reviewing -->";
const CLOSE = "<!-- /hawkeye: reviewing -->";
const BLOCK = new RegExp(`${OPEN}[\\s\\S]*?${CLOSE}\\n*`);

export function reviewingBadgeUrl(controlPlaneUrl: string, runnerName: string): string {
  return `${controlPlaneUrl}/status/reviewing?runner=${encodeURIComponent(runnerName)}`;
}

export function reviewingBlock(input: {
  controlPlaneUrl: string;
  runnerName: string;
  startedAt: Date;
}): string {
  const started = `${input.startedAt.toISOString().slice(11, 16)} UTC`;
  return [
    OPEN,
    `![Reviewing on ${input.runnerName}](${reviewingBadgeUrl(input.controlPlaneUrl, input.runnerName)})`,
    "",
    `Started ${started}. This comment is replaced when the review lands.`,
    CLOSE,
    "",
    "",
  ].join("\n");
}

export function stripReviewingBlock(body: string): string {
  return body.replace(BLOCK, "");
}

export function hasReviewingBlock(body: string): boolean {
  return BLOCK.test(body);
}

export const NOT_COMPLETED_BODY = "The review did not complete. The next push queues a new one.";
export const SUPERSEDED_BODY = "Superseded by a newer push; its review follows.";
export const ALREADY_POSTED_BODY =
  "Another run reviewed this push; its review is on this pull request.";

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function reviewingBadgeSvg(runnerName: string): string {
  const text = `Reviewing on ${runnerName}`;
  const width = Math.ceil(text.length * 7.3) + 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" viewBox="0 0 ${width} 20" role="img" aria-label="${escapeXml(text)}">`,
    "<defs>",
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">',
    '<stop offset="0" stop-color="#8b877f"/><stop offset="0.4" stop-color="#8b877f"/><stop offset="0.5" stop-color="#c9c4bb"/><stop offset="0.6" stop-color="#8b877f"/><stop offset="1" stop-color="#8b877f"/>',
    '<animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="1.8s" repeatCount="indefinite"/>',
    "</linearGradient>",
    "</defs>",
    `<text x="0" y="14" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="12" fill="url(#g)">${escapeXml(text)}</text>`,
    "</svg>",
  ].join("");
}

export type ReviewingTarget = {
  reference: PullRequestReference;
  headSha: string;
  token: string;
};

type Deps = { db: Db; github: GitHubClient; log?: (line: string) => void };

export async function markReviewing(
  deps: Deps,
  input: ReviewingTarget & {
    runId: string;
    livingReviewId: string | undefined;
    closedPlaceholderId: string | undefined;
    block: string;
  },
): Promise<void> {
  const { github } = deps;
  try {
    if (input.closedPlaceholderId) {
      await github.updateReview(
        input.reference,
        input.closedPlaceholderId,
        input.block,
        input.token,
      );
      await deps.db
        .update(run)
        .set({ placeholderReviewId: input.closedPlaceholderId })
        .where(eq(run.id, input.runId));
      return;
    }
    if (input.livingReviewId) {
      const { body } = await github.review(input.reference, input.livingReviewId, input.token);
      await github.updateReview(
        input.reference,
        input.livingReviewId,
        input.block + stripReviewingBlock(body),
        input.token,
      );
      return;
    }
    const posted = await github.postReview(
      input.reference,
      { event: "COMMENT", commit_id: input.headSha, body: input.block, comments: [] },
      input.token,
    );
    await deps.db
      .update(run)
      .set({ placeholderReviewId: posted.id })
      .where(eq(run.id, input.runId));
  } catch (error) {
    deps.log?.(
      `reviewing line not written for run ${input.runId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function clearReviewing(
  deps: Deps,
  input: ReviewingTarget & {
    runId: string;
    livingReviewId: string | undefined;
    placeholderReviewId: string | null;
    closing: string;
  },
): Promise<void> {
  const { github } = deps;
  try {
    if (input.placeholderReviewId) {
      await github.updateReview(
        input.reference,
        input.placeholderReviewId,
        input.closing,
        input.token,
      );
      return;
    }
    if (!input.livingReviewId) return;
    const { body } = await github.review(input.reference, input.livingReviewId, input.token);
    if (!hasReviewingBlock(body)) return;
    await github.updateReview(
      input.reference,
      input.livingReviewId,
      stripReviewingBlock(body),
      input.token,
    );
  } catch (error) {
    deps.log?.(
      `reviewing line not cleared for run ${input.runId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
