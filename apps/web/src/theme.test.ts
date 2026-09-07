import { describe, expect, it } from "vitest";
import { parseTheme, themeAttribute } from "./theme";

describe("parseTheme", () => {
  it("reads a stored choice and falls back to light", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme("sepia")).toBe("light");
  });
});

describe("themeAttribute", () => {
  it("stamps light and dark on the document and leaves system to the media query", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
  });
});
