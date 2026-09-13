import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { createTestDb } from "./test/pglite";
import { parseReviewSettings, readReviewSettings, saveReviewSettings } from "./user-settings";

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
