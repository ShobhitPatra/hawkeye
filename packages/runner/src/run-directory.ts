import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function createRunDirectory(input: {
  root: string;
  reference: { owner: string; repo: string; number: number };
  now: Date;
}): Promise<string> {
  const stamp = input.now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const directory = join(
    input.root,
    `${stamp}-${input.reference.owner}-${input.reference.repo}-${input.reference.number}`,
  );
  await mkdir(directory, { recursive: true });
  return directory;
}
