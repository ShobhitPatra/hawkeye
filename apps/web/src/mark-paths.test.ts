import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARK_EYE, MARK_PATHS } from "./mark-paths";

const source = new URL("../../../.claude/skills/hawkeye-design/mark.svg", import.meta.url);

describe("mark", () => {
  it("draws the same strokes and eye the design skill draws", () => {
    const svg = readFileSync(source, "utf8");
    expect([...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1])).toEqual([
      ...MARK_PATHS,
    ]);
    const eye = svg.match(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
    expect(eye && eye.slice(1, 4).map(Number)).toEqual([MARK_EYE.cx, MARK_EYE.cy, MARK_EYE.r]);
  });
});
