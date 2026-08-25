import { GitHubRequestError, type GitHubClient } from "../github/client.js";
import type { PullRequestReference } from "../github/pull-request-reference.js";
import type { RenderedReview } from "./render.js";

export type PostRenderedReviewInput = {
  github: Pick<GitHubClient, "postReview">;
  reference: PullRequestReference;
  token: string;
  review: RenderedReview;
  renderBodyOnly(): RenderedReview;
  log(line: string): void;
};
export type PostedReview = { review: RenderedReview; posted: { url: string; id: string } };

export async function postRenderedReview(input: PostRenderedReviewInput): Promise<PostedReview> {
  const { github, reference, token, review } = input;
  try {
    return { review, posted: await github.postReview(reference, review, token) };
  } catch (error) {
    if (
      !(error instanceof GitHubRequestError && error.status === 422) ||
      review.comments.length === 0
    )
      throw error;
    input.log("inline anchors rejected (422); posting body only");
    const bodyOnly = input.renderBodyOnly();
    return { review: bodyOnly, posted: await github.postReview(reference, bodyOnly, token) };
  }
}
