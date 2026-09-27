import { describe, expect, it } from "vitest";
import { connectCommand } from "./runner-command";

describe("connectCommand", () => {
  it("is the bare command on the hosted instance, where a fresh runner connects by default", () => {
    expect(connectCommand("https://hawkeye.reviews")).toBe("npx hawkeye-review runner");
  });
  it("names any other control plane", () => {
    expect(connectCommand("https://hawkeye.example")).toBe(
      "npx hawkeye-review runner --url https://hawkeye.example",
    );
  });
});
