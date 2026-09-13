import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { createTestDb } from "./test/pglite";
import {
  parseReviewSettings,
  parseRunnerSettings,
  readReviewSettings,
  readRunnerSettings,
  saveReviewSettings,
  saveRunnerSettings,
} from "./user-settings";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values({ id: "u1", name: "octocat", email: "o@example.com" });
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("readReviewSettings", () => {
  it("answers the defaults for a user without a row", async () => {
    expect(await readReviewSettings(db, "u1")).toEqual({
      autoReview: true,
      reviewDrafts: false,
      quietWindowSeconds: 0,
    });
  });
});

describe("saveReviewSettings", () => {
  it("creates the row, then updates it without touching the other columns", async () => {
    await saveReviewSettings(db, "u1", {
      autoReview: false,
      reviewDrafts: true,
      quietWindowSeconds: 90,
    });
    await db.update(schema.userSettings).set({ maxTurns: 12 });
    await saveReviewSettings(db, "u1", {
      autoReview: true,
      reviewDrafts: true,
      quietWindowSeconds: 0,
    });
    const [row] = await db.select().from(schema.userSettings);
    expect(row).toMatchObject({
      userId: "u1",
      autoReview: true,
      reviewDrafts: true,
      quietWindowSeconds: 0,
      maxTurns: 12,
    });
    expect(await readReviewSettings(db, "u1")).toEqual({
      autoReview: true,
      reviewDrafts: true,
      quietWindowSeconds: 0,
    });
  });
});

describe("parseReviewSettings", () => {
  it("reads the checkboxes and the wait", () => {
    expect(parseReviewSettings(form({ autoReview: "on", quietWindowSeconds: " 45 " }))).toEqual({
      autoReview: true,
      reviewDrafts: false,
      quietWindowSeconds: 45,
    });
  });

  it("accepts the ends of the range", () => {
    expect(parseReviewSettings(form({ quietWindowSeconds: "0" })).quietWindowSeconds).toBe(0);
    expect(parseReviewSettings(form({ quietWindowSeconds: "600" })).quietWindowSeconds).toBe(600);
  });

  it("refuses a missing, fractional, negative or too long wait", () => {
    for (const value of ["", "1.5", "-1", "abc"]) {
      expect(() => parseReviewSettings(form({ quietWindowSeconds: value }))).toThrow(
        "whole number of seconds",
      );
    }
    expect(() => parseReviewSettings(form({ quietWindowSeconds: "601" }))).toThrow(
      "at most 600 seconds",
    );
  });
});

describe("runner settings", () => {
  it("answers the defaults for a user without a row", async () => {
    expect(await readRunnerSettings(db, "u1")).toEqual({
      model: null,
      maxTurns: 40,
      wallClockMinutes: 15,
    });
  });

  it("saves the model and limits without touching the review settings", async () => {
    await saveReviewSettings(db, "u1", {
      autoReview: false,
      reviewDrafts: true,
      quietWindowSeconds: 30,
    });
    await saveRunnerSettings(db, "u1", {
      model: "claude-opus-5",
      maxTurns: 60,
      wallClockMinutes: 20,
    });
    expect(await readRunnerSettings(db, "u1")).toEqual({
      model: "claude-opus-5",
      maxTurns: 60,
      wallClockMinutes: 20,
    });
    expect(await readReviewSettings(db, "u1")).toMatchObject({
      autoReview: false,
      quietWindowSeconds: 30,
    });
    await saveRunnerSettings(db, "u1", { model: null, maxTurns: 60, wallClockMinutes: 20 });
    expect((await readRunnerSettings(db, "u1")).model).toBeNull();
  });

  it("refuses to read a model it does not know", async () => {
    await db.insert(schema.userSettings).values({ userId: "u1", model: "haiku" });
    await expect(readRunnerSettings(db, "u1")).rejects.toThrow("unknown model setting: haiku");
  });

  it("parses the radios and the limits", () => {
    expect(
      parseRunnerSettings(
        form({ model: "claude-sonnet-5", maxTurns: "12", wallClockMinutes: "5" }),
      ),
    ).toEqual({ model: "claude-sonnet-5", maxTurns: 12, wallClockMinutes: 5 });
    expect(
      parseRunnerSettings(form({ model: "", maxTurns: "1", wallClockMinutes: "60" })).model,
    ).toBeNull();
  });

  it("refuses an unknown model and limits outside the range", () => {
    expect(() =>
      parseRunnerSettings(form({ model: "haiku", maxTurns: "12", wallClockMinutes: "5" })),
    ).toThrow("not in the list");
    expect(
      parseRunnerSettings(
        form({ model: "claude-fable-5-1", maxTurns: "12", wallClockMinutes: "5" }),
      ).model,
    ).toBe("claude-fable-5-1");
    expect(() =>
      parseRunnerSettings(form({ model: "", maxTurns: "0", wallClockMinutes: "5" })),
    ).toThrow("Turns per review must be between 1 and 200.");
    expect(() =>
      parseRunnerSettings(form({ model: "", maxTurns: "201", wallClockMinutes: "5" })),
    ).toThrow("between 1 and 200");
    expect(() =>
      parseRunnerSettings(form({ model: "", maxTurns: "12", wallClockMinutes: "61" })),
    ).toThrow("Minutes per review must be between 1 and 60.");
    expect(() =>
      parseRunnerSettings(form({ model: "", maxTurns: "1.5", wallClockMinutes: "5" })),
    ).toThrow("whole number");
  });
});
