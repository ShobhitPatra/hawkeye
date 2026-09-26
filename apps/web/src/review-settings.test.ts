import { describe, expect, it } from "vitest";
import { isModelChoice, modelFor, MODELS, RETIRED_MODELS, retiredModel } from "./review-settings";

describe("isModelChoice", () => {
  it("accepts every offered model under its own harness only", () => {
    for (const model of MODELS) {
      expect(isModelChoice(model.harness, model.value)).toBe(true);
      const other = model.harness === "codex" ? "claude-code" : "codex";
      expect(isModelChoice(other, model.value)).toBe(false);
    }
  });
  it("rejects a retired model, an unknown one and an empty string", () => {
    expect(isModelChoice("claude-code", "claude-opus-4-8")).toBe(false);
    expect(isModelChoice("claude-code", "claude-haiku-4-5")).toBe(false);
    expect(isModelChoice("claude-code", "")).toBe(false);
  });
  it("rejects a value that differs only by case or whitespace", () => {
    const [{ harness, value }] = MODELS;
    expect(isModelChoice(harness, value.toUpperCase())).toBe(false);
    expect(isModelChoice(harness, ` ${value}`)).toBe(false);
    expect(isModelChoice(harness, `${value} `)).toBe(false);
  });
});

describe("retiredModel", () => {
  it("names a model that left the list, under its own harness only", () => {
    for (const model of RETIRED_MODELS) {
      expect(retiredModel(model.harness, model.value)).toEqual(model);
      expect(retiredModel("codex", model.value)).toBeUndefined();
    }
    expect(retiredModel("claude-code", "claude-opus-5-5")).toBeUndefined();
  });
});

describe("modelFor", () => {
  it("keeps an offered or retired model for its harness", () => {
    expect(modelFor("claude-code", "claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(modelFor("claude-code", "claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(modelFor("codex", "gpt-6-sol")).toBe("gpt-6-sol");
  });
  it("drops a model from the other harness, an unknown one, or none", () => {
    expect(modelFor("codex", "claude-opus-5")).toBeUndefined();
    expect(modelFor("claude-code", "gpt-6-sol")).toBeUndefined();
    expect(modelFor("claude-code", "haiku")).toBeUndefined();
    expect(modelFor("claude-code", null)).toBeUndefined();
  });
});
