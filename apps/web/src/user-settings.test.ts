import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { createTestDb } from "./test/pglite";
import { autoReviewEnabled, setAutoReview } from "./user-settings";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values({ id: "u1", name: "octocat", email: "o@example.com" });
});

describe("autoReviewEnabled", () => {
  it("is on for a user without a settings row", async () => {
    expect(await autoReviewEnabled(db, "u1")).toBe(true);
  });

  it("turns off and back on, keeping the other settings", async () => {
    await db.insert(schema.userSettings).values({ userId: "u1", maxTurns: 12 });
    await setAutoReview(db, "u1", false);
    expect(await autoReviewEnabled(db, "u1")).toBe(false);
    await setAutoReview(db, "u1", true);
    expect(await autoReviewEnabled(db, "u1")).toBe(true);
    const [row] = await db.select().from(schema.userSettings);
    expect(row?.maxTurns).toBe(12);
  });

  it("creates the settings row when none exists", async () => {
    await setAutoReview(db, "u1", false);
    const rows = await db.select().from(schema.userSettings);
    expect(rows.map((row) => [row.userId, row.autoReview])).toEqual([["u1", false]]);
  });
});
