import { describe, expect, it } from "vitest";
import { indentLines } from "./format.js";

describe("indentLines", () => {
  it("indents a single line", () => {
    expect(indentLines("one", "  ")).toEqual(["  one"]);
  });
  it("indents every line of several", () => {
    expect(indentLines("one\ntwo\nthree", "> ")).toEqual(["> one", "> two", "> three"]);
  });
  it("leaves an empty line empty rather than indenting it", () => {
    expect(indentLines("one\n\ntwo", "  ")).toEqual(["  one", "", "  two"]);
  });
  it("returns one empty line for empty text", () => {
    expect(indentLines("", "  ")).toEqual([""]);
  });
  it("leaves the text unchanged with an empty indent", () => {
    expect(indentLines("one\n\ntwo", "")).toEqual(["one", "", "two"]);
  });
});
