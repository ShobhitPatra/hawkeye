import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROUND_PREFIX = "round-";

export function pullRequestDirectory(
  root: string,
  reference: { owner: string; repo: string; number: number },
): string {
  return join(root, reference.owner, reference.repo, String(reference.number));
}

export async function listRounds(pullRequestDir: string): Promise<string[]> {
  const entries = await readdir(pullRequestDir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isDirectory() && /^round-[1-9]\d*$/.test(entry.name))
    .map((entry) => entry.name);
}

export async function createRound(
  pullRequestDir: string,
): Promise<{ round: number; directory: string }> {
  const rounds = await listRounds(pullRequestDir);
  await Promise.all(
    rounds.map((name) =>
      rm(join(pullRequestDir, name, "checkout"), { recursive: true, force: true }),
    ),
  );
  const round =
    rounds.reduce(
      (highest, name) => Math.max(highest, Number(name.slice(ROUND_PREFIX.length))),
      0,
    ) + 1;
  const directory = join(pullRequestDir, `${ROUND_PREFIX}${round}`);
  await mkdir(directory, { recursive: true });
  return { round, directory };
}
