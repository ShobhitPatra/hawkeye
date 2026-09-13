"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/session";
import { parseReviewSettings, saveReviewSettings } from "@/user-settings";

export type SaveState = { saved?: true; error?: string };

export async function saveReviewSettingsAction(
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const session = await requireSession();
  let settings;
  try {
    settings = parseReviewSettings(formData);
  } catch (error) {
    return { error: (error as Error).message };
  }
  await saveReviewSettings(getDb(), session.user.id, settings);
  revalidatePath("/settings");
  return { saved: true };
}
