import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  DEFAULT_MAX_TURNS,
  DEFAULT_QUIET_WINDOW_SECONDS,
  DEFAULT_WALL_CLOCK_MINUTES,
  userSettings,
} from "./db/schema";
import {
  MAX_QUIET_WINDOW_SECONDS,
  MAX_TURNS_RANGE,
  MODEL_CHOICES,
  type ModelChoice,
  type ReviewSettings,
  type RunnerSettings,
  WALL_CLOCK_MINUTES_RANGE,
} from "./review-settings";

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

export const DEFAULT_RUNNER_SETTINGS: RunnerSettings = {
  model: null,
  maxTurns: DEFAULT_MAX_TURNS,
  wallClockMinutes: DEFAULT_WALL_CLOCK_MINUTES,
};

function isModelChoice(value: string): value is ModelChoice {
  return (MODEL_CHOICES as readonly string[]).includes(value);
}

export async function readRunnerSettings(db: Db, userId: string): Promise<RunnerSettings> {
  const [row] = await db
    .select({
      model: userSettings.model,
      maxTurns: userSettings.maxTurns,
      wallClockMinutes: userSettings.wallClockMinutes,
    })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  if (!row) return DEFAULT_RUNNER_SETTINGS;
  if (row.model !== null && !isModelChoice(row.model)) {
    throw new Error(`user ${userId} has an unknown model setting: ${row.model}`);
  }
  return { model: row.model, maxTurns: row.maxTurns, wallClockMinutes: row.wallClockMinutes };
}

export async function saveRunnerSettings(
  db: Db,
  userId: string,
  settings: RunnerSettings,
): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, ...settings })
    .onConflictDoUpdate({ target: userSettings.userId, set: settings });
}

function wholeNumber(
  formData: FormData,
  name: string,
  label: string,
  range: { min: number; max: number },
): number {
  const raw = String(formData.get(name) ?? "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a whole number.`);
  const value = Number(raw);
  if (value < range.min || value > range.max) {
    throw new Error(`${label} must be between ${range.min} and ${range.max}.`);
  }
  return value;
}

export function parseRunnerSettings(formData: FormData): RunnerSettings {
  const rawModel = String(formData.get("model") ?? "");
  if (rawModel !== "" && !isModelChoice(rawModel)) {
    throw new Error("That model is not in the list.");
  }
  return {
    model: rawModel === "" ? null : rawModel,
    maxTurns: wholeNumber(formData, "maxTurns", "Turns per review", MAX_TURNS_RANGE),
    wallClockMinutes: wholeNumber(
      formData,
      "wallClockMinutes",
      "Minutes per review",
      WALL_CLOCK_MINUTES_RANGE,
    ),
  };
}
