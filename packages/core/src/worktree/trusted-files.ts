import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const MEMORY_FILES = ["CLAUDE.md", "CLAUDE.local.md"];
const CONFIG_DIRECTORY = ".claude";
const SKIPPED_DIRECTORIES = [".git", "node_modules"];

export async function removeTrustedConfig(root: string): Promise<string[]> {
  const removed: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
        if (entry.name === CONFIG_DIRECTORY) {
          await rm(path, { recursive: true, force: true });
          removed.push(path);
          continue;
        }
        await walk(path);
        continue;
      }
      if (!MEMORY_FILES.includes(entry.name)) continue;
      await rm(path, { force: true });
      removed.push(path);
    }
  };
  await walk(root);
  return removed;
}
