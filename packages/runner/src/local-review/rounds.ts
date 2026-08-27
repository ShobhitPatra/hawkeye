import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Finding, findingId, parseReviewResult, type ReviewResult } from "@hawkeye/core";

const ROUND_PREFIX = "round-";

export type RoundMeta = {
  round: number;
  headSha: string;
  baseSha: string;
  mergeBaseSha: string;
  startedAt: string;
  pullRequest: { owner: string; repo: string; number: number; title: string; author: string };
  previousRound?: number;
  previousHeadSha?: string;
};
export type Round = { directory: string; meta: RoundMeta; result?: ReviewResult };
export type Dismissals = Record<string, string>;
export type DismissedFinding = { note: string; finding: Finding };
export type DismissedFindings = Record<string, DismissedFinding>;

export function parseRoundMeta(raw: unknown, path: string): RoundMeta {
  const meta = raw as Partial<RoundMeta> | null;
  if (
    typeof meta !== "object" ||
    meta === null ||
    !Number.isInteger(meta.round) ||
    typeof meta.headSha !== "string" ||
    meta.headSha === ""
  )
    throw new Error(`${path} is not a round meta file: round and headSha are required`);
  return meta as RoundMeta;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

export async function readRoundMeta(directory: string): Promise<RoundMeta> {
  const metaPath = join(directory, "meta.json");
  return parseRoundMeta(JSON.parse(await readFile(metaPath, "utf8")), metaPath);
}

export async function readRoundResult(directory: string): Promise<ReviewResult | undefined> {
  const raw = await readOptionalFile(join(directory, "result.json"));
  return raw === undefined ? undefined : parseReviewResult(JSON.parse(raw));
}

export async function readRound(directory: string): Promise<Round> {
  const meta = await readRoundMeta(directory);
  const result = await readRoundResult(directory);
  return { directory, meta, ...(result === undefined ? {} : { result }) };
}

export async function latestCompletedRound(
  pullRequestDir: string,
  warn: (line: string) => void = () => {},
): Promise<Required<Round> | undefined> {
  const rounds = await listRounds(pullRequestDir);
  for (const name of rounds.reverse()) {
    const directory = join(pullRequestDir, name);
    try {
      const round = await readRound(directory);
      if (round.result !== undefined) return { ...round, result: round.result };
    } catch (error) {
      warn(`skipping ${directory}: ${(error as Error).message}`);
    }
  }
  return undefined;
}

function parseDismissals(raw: unknown, path: string): Dismissals {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error(`${path} is not a dismissal file: expected an object of id to reason`);
  for (const [id, reason] of Object.entries(raw))
    if (typeof reason !== "string" || reason.trim() === "")
      throw new Error(`${path} is not a dismissal file: ${id} needs a reason`);
  return raw as Dismissals;
}

export async function readDismissals(directory: string): Promise<Dismissals> {
  const path = join(directory, "dismissed.json");
  const raw = await readOptionalFile(path);
  return raw === undefined ? {} : parseDismissals(JSON.parse(raw), path);
}

export async function collectDismissals(
  pullRequestDir: string,
  before: number,
  warn: (line: string) => void = () => {},
): Promise<DismissedFindings> {
  const merged: DismissedFindings = {};
  for (const name of await listRounds(pullRequestDir)) {
    const directory = join(pullRequestDir, name);
    if (Number(name.slice(ROUND_PREFIX.length)) >= before) continue;
    try {
      const dismissals = await readDismissals(directory);
      if (Object.keys(dismissals).length === 0) continue;
      const result = await readRoundResult(directory);
      if (result === undefined) continue;
      for (const finding of result.findings) {
        const note = dismissals[findingId(finding.path, finding.claim)];
        if (note !== undefined) merged[findingId(finding.path, finding.claim)] = { note, finding };
      }
    } catch (error) {
      warn(`skipping ${directory}: ${(error as Error).message}`);
    }
  }
  return merged;
}

export async function dismissFinding(
  directory: string,
  id: string,
  reason: string,
): Promise<Dismissals> {
  if (reason.trim() === "") throw new Error("a dismissal needs a reason");
  const result = await readRoundResult(directory);
  if (result === undefined) throw new Error(`no review yet in ${directory}`);
  if (!result.findings.some((finding) => findingId(finding.path, finding.claim) === id))
    throw new Error(`no finding ${id} in ${join(directory, "result.json")}`);
  const dismissals = { ...(await readDismissals(directory)), [id]: reason };
  await writeFile(join(directory, "dismissed.json"), JSON.stringify(dismissals, null, 2));
  return dismissals;
}

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
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice(ROUND_PREFIX.length)) - Number(b.slice(ROUND_PREFIX.length)));
}

export async function createRound(
  pullRequestDir: string,
): Promise<{ round: number; directory: string }> {
  const rounds = await listRounds(pullRequestDir);
  const round =
    rounds.reduce(
      (highest, name) => Math.max(highest, Number(name.slice(ROUND_PREFIX.length))),
      0,
    ) + 1;
  const directory = join(pullRequestDir, `${ROUND_PREFIX}${round}`);
  await mkdir(directory, { recursive: true });
  return { round, directory };
}

export async function pruneOlderCheckouts(pullRequestDir: string, keep: number): Promise<void> {
  const rounds = await listRounds(pullRequestDir);
  await Promise.all(
    rounds
      .filter((name) => name !== `${ROUND_PREFIX}${keep}`)
      .map((name) => rm(join(pullRequestDir, name, "checkout"), { recursive: true, force: true })),
  );
}
