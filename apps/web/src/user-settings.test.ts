import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { createTestDb } from "./test/pglite";
import {
  FieldError,
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
      harness: "claude-code",
      model: null,
      maxTurns: 40,
      wallClockMinutes: 15,
      concurrency: 1,
    });
  });

  it("saves the model and limits without touching the review settings", async () => {
    await saveReviewSettings(db, "u1", {
      autoReview: false,
      reviewDrafts: true,
      quietWindowSeconds: 30,
    });
    await saveRunnerSettings(db, "u1", {
      harness: "codex",
      model: "claude-opus-5",
      maxTurns: 60,
      wallClockMinutes: 20,
      concurrency: 2,
    });
    expect(await readRunnerSettings(db, "u1")).toEqual({
      harness: "codex",
      model: "claude-opus-5",
      maxTurns: 60,
      wallClockMinutes: 20,
      concurrency: 2,
    });
    expect(await readReviewSettings(db, "u1")).toMatchObject({
      autoReview: false,
      quietWindowSeconds: 30,
    });
    await saveRunnerSettings(db, "u1", {
      harness: "claude-code",
      model: null,
      maxTurns: 60,
      wallClockMinutes: 20,
      concurrency: 2,
    });
    expect((await readRunnerSettings(db, "u1")).model).toBeNull();
  });

  it("returns a stored model that has left the list, so the page can say so", async () => {
    await db.insert(schema.userSettings).values({ userId: "u1", model: "haiku" });
    expect((await readRunnerSettings(db, "u1")).model).toBe("haiku");
  });

  it("parses the choice and the limits", () => {
    expect(
      parseRunnerSettings(
        form({
          choice: "claude-code:claude-sonnet-5",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toEqual({
      harness: "claude-code",
      model: "claude-sonnet-5",
      maxTurns: 12,
      wallClockMinutes: 5,
      concurrency: 1,
    });
    expect(
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "1",
          wallClockMinutes: "60",
          concurrency: "1",
        }),
      ).model,
    ).toBeNull();
  });

  it("refuses a harness that is not in the list", () => {
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "gemini:",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toThrow("That harness is not in the list.");
    expect(
      parseRunnerSettings(
        form({
          choice: "codex:",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ).harness,
    ).toBe("codex");
  });

  it("keeps a retired model under its own CLI and refuses one from the other CLI", () => {
    const limits = { maxTurns: "12", wallClockMinutes: "5", concurrency: "1" };
    expect(
      parseRunnerSettings(form({ choice: "claude-code:claude-opus-4-8", ...limits })),
    ).toMatchObject({ harness: "claude-code", model: "claude-opus-4-8" });
    expect(parseRunnerSettings(form({ choice: "codex:gpt-6-sol", ...limits }))).toMatchObject({
      harness: "codex",
      model: "gpt-6-sol",
    });
    expect(() => parseRunnerSettings(form({ choice: "codex:claude-opus-5", ...limits }))).toThrow(
      "That model is not in the list.",
    );
    expect(() => parseRunnerSettings(form({ choice: "claude-code", ...limits }))).toThrow(
      "That harness is not in the list.",
    );
  });

  it("refuses an unknown model and limits outside the range", () => {
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:haiku",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toThrow("not in the list");
    expect(
      parseRunnerSettings(
        form({
          choice: "claude-code:claude-fable-5-1",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ).model,
    ).toBe("claude-fable-5-1");
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "0",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toThrow("Turns per review must be between 1 and 200.");
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "201",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toThrow("between 1 and 200");
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "12",
          wallClockMinutes: "61",
          concurrency: "1",
        }),
      ),
    ).toThrow("Minutes per review must be between 1 and 60.");
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "1.5",
          wallClockMinutes: "5",
          concurrency: "1",
        }),
      ),
    ).toThrow("whole number");
    expect(() =>
      parseRunnerSettings(
        form({
          choice: "claude-code:",
          maxTurns: "12",
          wallClockMinutes: "5",
          concurrency: "4",
        }),
      ),
    ).toThrow("Reviews at once must be between 1 and 3.");
  });
});

function refusal(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error instanceof FieldError ? error.field : undefined;
  }
  return undefined;
}

describe("field refusals", () => {
  it("names the field a refusal is about", () => {
    expect(refusal(() => parseReviewSettings(form({ quietWindowSeconds: "601" })))).toBe(
      "quietWindowSeconds",
    );
    expect(
      refusal(() =>
        parseRunnerSettings(
          form({ choice: "claude-code:", maxTurns: "0", wallClockMinutes: "5", concurrency: "1" }),
        ),
      ),
    ).toBe("maxTurns");
    expect(refusal(() => parseRunnerSettings(form({ choice: "vim:" })))).toBe("model");
    const runner = {
      choice: "claude-code:",
      maxTurns: "20",
      wallClockMinutes: "5",
      concurrency: "1",
    };
    expect(refusal(() => parseRunnerSettings(form({ ...runner, choice: "claude-code:gpt" })))).toBe(
      "model",
    );
    expect(refusal(() => parseRunnerSettings(form({ ...runner, wallClockMinutes: "0" })))).toBe(
      "wallClockMinutes",
    );
    expect(refusal(() => parseRunnerSettings(form({ ...runner, concurrency: "9" })))).toBe(
      "concurrency",
    );
  });
});
