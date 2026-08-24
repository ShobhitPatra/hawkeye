import { GitHubRequestError, type GitHubClient } from "../github/client.js";
import type { PullRequestReference } from "../github/pull-request-reference.js";
import type { RenderedReview } from "./render.js";

export type PostRenderedReviewInput = {
  github: Pick<GitHubClient, "postReview">;
  reference: PullRequestReference;
  token: string;
  render(commentable: Map<string, Set<number>>): RenderedReview;
  commentable: Map<string, Set<number>>;
  log(line: string): void;
};
export type PostedReview = { review: RenderedReview; posted: { url: string; id: string } };

export async function postRenderedReview(input: PostRenderedReviewInput): Promise<PostedReview> {
  const { github, reference, token } = input;
  const review = input.render(input.commentable);
  try {
    return { review, posted: await github.postReview(reference, review, token) };
  } catch (error) {
    if (
      !(error instanceof GitHubRequestError && error.status === 422) ||
      review.comments.length === 0
    )
      throw error;
    input.log("inline anchors rejected (422); posting body only");
    const bodyOnly = input.render(new Map());
    return { review: bodyOnly, posted: await github.postReview(reference, bodyOnly, token) };
  }
}
