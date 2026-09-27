import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { npmReadme } from "./readme.js";

const body = (readme: string) => npmReadme(readme).split("\n\n").slice(1).join("\n\n");

describe("npmReadme", () => {
  it("points relative links at the repository and relative images at its raw files", () => {
    expect(body("[guide](docs/self-hosting.md)")).toBe(
      "[guide](https://github.com/ShobhitPatra/hawkeye/blob/main/docs/self-hosting.md)",
    );
    expect(body('<a href="LICENSE">')).toBe(
      '<a href="https://github.com/ShobhitPatra/hawkeye/blob/main/LICENSE">',
    );
    expect(
      body('<img src=".github/banner-light.svg"> <source srcset=".github/banner-dark.svg">'),
    ).toBe(
      '<img src="https://raw.githubusercontent.com/ShobhitPatra/hawkeye/main/.github/banner-light.svg"> <source srcset="https://raw.githubusercontent.com/ShobhitPatra/hawkeye/main/.github/banner-dark.svg">',
    );
    expect(body("![mark](.github/mark.svg)")).toBe(
      "![mark](https://raw.githubusercontent.com/ShobhitPatra/hawkeye/main/.github/mark.svg)",
    );
  });
  it("leaves absolute links, mail links and anchors alone", () => {
    const text =
      '[a](https://hawkeye.reviews) [b](mailto:x@example.com) [c](#start) <a href="https://x.dev">';
    expect(body(text)).toBe(text);
  });
  it("marks the copy as generated", () => {
    expect(
      npmReadme("# hawkeye").startsWith("<!-- Generated from the repository's README.md"),
    ).toBe(true);
  });
  it("is what the runner package ships, so npm shows the repository's README", () => {
    const root = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    const shipped = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(shipped, "packages/runner/README.md is stale; run pnpm readme").toBe(npmReadme(root));
  });
});
