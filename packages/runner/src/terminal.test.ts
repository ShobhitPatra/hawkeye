import { describe, expect, it } from "vitest";
import { progressLine, terminalStyle } from "./terminal.js";

describe("terminalStyle", () => {
  it("colors on a TTY", () => {
    const style = terminalStyle({ isTTY: true, env: {} });
    expect(style.verdict("Ship")).toBe("\u001b[1mShip\u001b[22m");
    expect(style.must("Must fix")).toBe("\u001b[31mMust fix\u001b[39m");
    expect(style.dim("a.ts")).toBe("\u001b[2ma.ts\u001b[22m");
    expect(style.warn("waiting")).toBe("\u001b[33mwaiting\u001b[39m");
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
      expect(style.warn("waiting")).toBe("waiting");
    }
  });
});

describe("progressLine", () => {
  it("rewrites one line in place on a TTY and clears it", () => {
    const written: string[] = [];
    const line = progressLine({ isTTY: true, write: (text) => written.push(text) });
    line.update("Reviewing · 1 turn");
    line.update("Reviewing · 2 turns");
    line.clear();
    expect(written).toEqual([
      "\r\u001b[2KReviewing · 1 turn",
      "\r\u001b[2KReviewing · 2 turns",
      "\r\u001b[2K",
    ]);
  });
  it("writes nothing when piped", () => {
    const written: string[] = [];
    const line = progressLine({ isTTY: false, write: (text) => written.push(text) });
    line.update("Reviewing");
    line.clear();
    expect(written).toEqual([]);
  });
});
