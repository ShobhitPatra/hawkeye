import { describe, expect, it } from "vitest";
import { parseTheme, themeAttribute } from "./theme";

describe("parseTheme", () => {
  it("reads a stored choice and falls back to system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("stamps light and dark on the document and leaves system to the media query", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });
});
