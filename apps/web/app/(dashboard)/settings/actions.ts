"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/session";
import {
  FieldError,
  parseReviewSettings,
  parseRunnerSettings,
  saveReviewSettings,
  saveRunnerSettings,
} from "@/user-settings";

export type SaveState = { saved?: true; error?: string; field?: string };

function refused(error: unknown): SaveState {
  return error instanceof FieldError
    ? { error: error.message, field: error.field }
    : { error: (error as Error).message };
}

export async function saveReviewSettingsAction(
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const session = await requireSession();
  let settings;
  try {
    settings = parseReviewSettings(formData);
  } catch (error) {
    return refused(error);
  }
  await saveReviewSettings(getDb(), session.user.id, settings);
  revalidatePath("/settings");
  return { saved: true };
}

export async function saveRunnerSettingsAction(
  _previous: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const session = await requireSession();
  let settings;
  try {
    settings = parseRunnerSettings(formData);
  } catch (error) {
    return refused(error);
  }
  await saveRunnerSettings(getDb(), session.user.id, settings);
  revalidatePath("/settings");
  return { saved: true };
}
