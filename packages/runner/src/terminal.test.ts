import { describe, expect, it } from "vitest";
import { terminalStyle } from "./terminal.js";

describe("terminalStyle", () => {
  it("colors on a TTY", () => {
    const style = terminalStyle({ isTTY: true, env: {} });
    expect(style.verdict("Ship")).toBe("\u001b[1mShip\u001b[22m");
    expect(style.must("Must fix")).toBe("\u001b[31mMust fix\u001b[39m");
    expect(style.dim("a.ts")).toBe("\u001b[2ma.ts\u001b[22m");
  });
  it("prints plain text when piped, under NO_COLOR, or on a dumb terminal", () => {
    for (const input of [
      { isTTY: false, env: {} },
      { isTTY: undefined, env: {} },
      { isTTY: true, env: { NO_COLOR: "" } },
      { isTTY: true, env: { TERM: "dumb" } },
    ]) {
      const style = terminalStyle(input);
      expect(style.verdict("Ship")).toBe("Ship");
      expect(style.must("Must fix")).toBe("Must fix");
      expect(style.dim("a.ts")).toBe("a.ts");
    }
  });
});
