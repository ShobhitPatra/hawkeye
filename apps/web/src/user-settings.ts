import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { userSettings } from "./db/schema";

export async function autoReviewEnabled(db: Db, userId: string): Promise<boolean> {
  const [settings] = await db
    .select({ autoReview: userSettings.autoReview })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return settings?.autoReview ?? true;
}

export async function setAutoReview(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, autoReview: enabled })
    .onConflictDoUpdate({ target: userSettings.userId, set: { autoReview: enabled } });
}
