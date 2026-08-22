import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { removeTrustedConfig } from "./trusted-files.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hawkeye-trusted-"));
  await mkdir(join(root, ".claude"), { recursive: true });
  await mkdir(join(root, "packages", "x", ".claude", "agents"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await writeFile(join(root, "CLAUDE.md"), "root memory");
  await writeFile(join(root, "CLAUDE.local.md"), "root local memory");
  await writeFile(join(root, ".claude", "settings.json"), "{}");
  await writeFile(join(root, "packages", "x", "CLAUDE.md"), "nested memory");
  await writeFile(join(root, "packages", "x", ".claude", "agents", "a.md"), "agent");
  await writeFile(join(root, "packages", "x", "keep.ts"), "export {};");
  await writeFile(join(root, ".git", "CLAUDE.md"), "history");
  await writeFile(join(root, "node_modules", "dep", "CLAUDE.md"), "dep memory");
  return root;
}

const gone = async (path: string) => {
  await expect(stat(path)).rejects.toThrow();
};

describe("removeTrustedConfig", () => {
  it("removes memory files and .claude directories at every depth", async () => {
    const root = await fixture();
    const removed = await removeTrustedConfig(root);
    await gone(join(root, "CLAUDE.md"));
    await gone(join(root, "CLAUDE.local.md"));
    await gone(join(root, ".claude"));
    await gone(join(root, "packages", "x", "CLAUDE.md"));
    await gone(join(root, "packages", "x", ".claude"));
    expect(removed).toContain(join(root, "packages", "x", "CLAUDE.md"));
    expect(removed).toContain(join(root, ".claude"));
  });
  it("keeps everything else, including .git and node_modules", async () => {
    const root = await fixture();
    const removed = await removeTrustedConfig(root);
    expect((await stat(join(root, ".git", "CLAUDE.md"))).isFile()).toBe(true);
    expect((await stat(join(root, "node_modules", "dep", "CLAUDE.md"))).isFile()).toBe(true);
    expect((await stat(join(root, "packages", "x", "keep.ts"))).isFile()).toBe(true);
    expect(removed).not.toContain(join(root, ".git", "CLAUDE.md"));
    expect(removed).not.toContain(join(root, "node_modules", "dep", "CLAUDE.md"));
  });
  it("returns nothing when the checkout has no trusted config", async () => {
    const root = await mkdtemp(join(tmpdir(), "hawkeye-trusted-"));
    await writeFile(join(root, "a.txt"), "one");
    expect(await removeTrustedConfig(root)).toEqual([]);
  });
});
