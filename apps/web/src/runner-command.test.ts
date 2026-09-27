import { describe, expect, it } from "vitest";
import { connectCommand } from "./runner-command";

describe("connectCommand", () => {
  it("names the control plane, the hosted one included", () => {
    expect(connectCommand("https://hawkeye.reviews")).toBe(
      "npx hawkeye-review runner --url https://hawkeye.reviews",
    );
    expect(connectCommand("https://hawkeye.example")).toBe(
      "npx hawkeye-review runner --url https://hawkeye.example",
    );
  });
});
