import { describe, expect, it } from "vitest";
import { isModelChoice, MODELS } from "./review-settings";

describe("isModelChoice", () => {
  it("accepts every pinned model", () => {
    for (const model of MODELS) expect(isModelChoice(model.value)).toBe(true);
  });
  it("rejects a model that is not in the list", () => {
    expect(isModelChoice("claude-haiku-4-5")).toBe(false);
  });
  it("rejects an empty string", () => {
    expect(isModelChoice("")).toBe(false);
  });
  it("rejects a value that differs only by case or whitespace", () => {
    const [{ value }] = MODELS;
    expect(isModelChoice(value.toUpperCase())).toBe(false);
    expect(isModelChoice(` ${value}`)).toBe(false);
    expect(isModelChoice(`${value} `)).toBe(false);
  });
});
