import { decodeMarker } from "./marker.js";

export type ExistingReview = { authorLogin: string; body: string; id?: string };

export function alreadyReviewed(
  reviews: ExistingReview[],
  headSha: string,
  botLogin: string,
): boolean {
  return reviews.some((r) => r.authorLogin === botLogin && decodeMarker(r.body) === headSha);
}
