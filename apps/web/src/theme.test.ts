import { describe, expect, it } from "vitest";
import { parseTheme, THEME_COLORS, themeAttribute } from "./theme";
import { readFileSync } from "node:fs";

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

describe("THEME_COLORS", () => {
  it("match the stylesheet's page background in both schemes", () => {
    const stylesheet = readFileSync(
      new URL("../../../.claude/skills/hawkeye-design/stylesheet.css", import.meta.url),
      "utf8",
    );
    const backgrounds = [...stylesheet.matchAll(/--hk-bg: (#[0-9a-f]{6});/g)].map((m) => m[1]);
    expect(backgrounds[0]).toBe(THEME_COLORS.light);
    expect(new Set(backgrounds.slice(1))).toEqual(new Set([THEME_COLORS.dark]));
  });
});
