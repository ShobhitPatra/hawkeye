import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { DEFAULT_QUIET_WINDOW_SECONDS, userSettings } from "./db/schema";

export const MAX_QUIET_WINDOW_SECONDS = 600;

export type ReviewSettings = {
  autoReview: boolean;
  reviewDrafts: boolean;
  quietWindowSeconds: number;
};

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  autoReview: true,
  reviewDrafts: false,
  quietWindowSeconds: DEFAULT_QUIET_WINDOW_SECONDS,
};

export async function readReviewSettings(db: Db, userId: string): Promise<ReviewSettings> {
  const [row] = await db
    .select({
      autoReview: userSettings.autoReview,
      reviewDrafts: userSettings.reviewDrafts,
      quietWindowSeconds: userSettings.quietWindowSeconds,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row ?? DEFAULT_REVIEW_SETTINGS;
}

export async function saveReviewSettings(
  db: Db,
  userId: string,
  settings: ReviewSettings,
): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, ...settings })
    .onConflictDoUpdate({ target: userSettings.userId, set: settings });
}

export function parseReviewSettings(formData: FormData): ReviewSettings {
  const raw = String(formData.get("quietWindowSeconds") ?? "").trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error("The wait after a push must be a whole number of seconds.");
  }
  const quietWindowSeconds = Number(raw);
  if (quietWindowSeconds > MAX_QUIET_WINDOW_SECONDS) {
    throw new Error(`The wait after a push can be at most ${MAX_QUIET_WINDOW_SECONDS} seconds.`);
  }
  return {
    autoReview: formData.get("autoReview") === "on",
    reviewDrafts: formData.get("reviewDrafts") === "on",
    quietWindowSeconds,
  };
}
