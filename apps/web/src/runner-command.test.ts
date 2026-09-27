import { describe, expect, it } from "vitest";
import { urlFlag } from "./runner-command";

describe("urlFlag", () => {
  it("is empty on the hosted instance, where the runner connects by default", () => {
    expect(urlFlag("https://hawkeye.reviews")).toBe("");
  });
  it("names any other control plane", () => {
    expect(urlFlag("https://hawkeye.example")).toBe(" --url https://hawkeye.example");
  });
});
