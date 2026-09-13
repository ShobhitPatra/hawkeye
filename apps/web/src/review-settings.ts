export const MAX_QUIET_WINDOW_SECONDS = 600;

export type ReviewSettings = {
  autoReview: boolean;
  reviewDrafts: boolean;
  quietWindowSeconds: number;
};
