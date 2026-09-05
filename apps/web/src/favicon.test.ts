import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const served = new URL("../public/favicon.svg", import.meta.url);
const source = new URL("../../../.claude/skills/hawkeye-design/favicon.svg", import.meta.url);

describe("favicon", () => {
  it("serves the same mark the design skill draws", () => {
    expect(readFileSync(served, "utf8")).toBe(readFileSync(source, "utf8"));
  });
});
