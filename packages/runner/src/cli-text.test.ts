import { describe, expect, it } from "vitest";
import { alreadyReviewedLines, connectedLines } from "./cli-text.js";

describe("connectedLines", () => {
  it("names the runner after the device flow and shortens the config path", () => {
    expect(
      connectedLines({
        runnerName: "laptop",
        configPath: "/home/u/.config/hawkeye/runner.json",
        home: "/home/u",
      }),
    ).toEqual([
      "Connected as laptop. Token saved to ~/.config/hawkeye/runner.json.",
      "Start reviewing with: npx hawkeye-review runner",
    ]);
  });
  it("omits the name when a token was pasted", () => {
    expect(connectedLines({ runnerName: undefined, configPath: "/c.json", home: "/h" })[0]).toBe(
      "Connected. Token saved to /c.json.",
    );
  });
});

describe("alreadyReviewedLines", () => {
  it("names the pull request and the head and points at --force", () => {
    expect(alreadyReviewedLines({ owner: "o", repo: "r", number: 7 }, "a".repeat(40))).toEqual([
      "o/r#7 at aaaaaaa is already reviewed.",
      "Run again with --force to review it again.",
    ]);
  });
});
