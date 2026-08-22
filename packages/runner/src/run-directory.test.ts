import { stat, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRunDirectory } from "./run-directory.js";

describe("createRunDirectory", () => {
  it("creates a timestamped directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-root-"));
    const dir = await createRunDirectory({
      root,
      reference: { owner: "o", repo: "r", number: 4 },
      now: new Date("2026-08-22T13:05:09Z"),
    });
    expect(dir).toBe(join(root, "20260822-130509-o-r-4"));
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});
