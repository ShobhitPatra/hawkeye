import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type Finding,
  findingId,
  parseReviewResult,
  type PriorFinding,
  type ReviewResult,
} from "@hawkeye/core";

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
  carriedFindings?: string[];
};
export type Round = { directory: string; meta: RoundMeta; result?: ReviewResult };
export type Dismissals = Record<string, string>;
export type DismissedFinding = { note: string; finding: Finding };
export type DismissedFindings = Record<string, DismissedFinding>;

function parseRoundMeta(raw: unknown, path: string): RoundMeta {
  const meta = raw as Partial<RoundMeta> | null;
  if (
    typeof meta !== "object" ||
    meta === null ||
    !Number.isInteger(meta.round) ||
    typeof meta.headSha !== "string" ||
    meta.headSha === "" ||
    typeof meta.startedAt !== "string" ||
    meta.startedAt === ""
  )
    throw new Error(`${path} is not a round meta file: round, headSha and startedAt are required`);
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
  const raw = await readFile(metaPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new Error(`No round at ${directory}. Run hawkeye-review prepare first.`);
    throw error;
  });
  return parseRoundMeta(JSON.parse(raw), metaPath);
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
  for (const name of rounds.toReversed()) {
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

async function collectOpenFindings(
  pullRequestDir: string,
  before: number,
  warn: (line: string) => void = () => {},
): Promise<Record<string, Finding>> {
  const known: Record<string, Finding> = {};
  const open = new Set<string>();
  for (const name of await listRounds(pullRequestDir)) {
    if (Number(name.slice(ROUND_PREFIX.length)) >= before) continue;
    const directory = join(pullRequestDir, name);
    let result: ReviewResult | undefined;
    try {
      result = await readRoundResult(directory);
    } catch (error) {
      warn(`skipping ${directory}: ${(error as Error).message}`);
      continue;
    }
    if (result === undefined) continue;
    for (const prior of result.priorFindings ?? [])
      if (prior.status === "open") open.add(prior.id);
      else open.delete(prior.id);
    for (const finding of result.findings) {
      const id = findingId(finding.path, finding.claim);
      known[id] = finding;
      open.add(id);
    }
  }
  return Object.fromEntries([...open].filter((id) => id in known).map((id) => [id, known[id]!]));
}

export async function priorFindingsBefore(
  pullRequestDir: string,
  round: number,
  previousFindings: Finding[],
  warn: (line: string) => void = () => {},
): Promise<PriorFinding[]> {
  const dismissed = await collectDismissals(pullRequestDir, round, warn);
  const open = await collectOpenFindings(pullRequestDir, round, warn);
  const carried = new Set<string>();
  const findings: PriorFinding[] = previousFindings.map((finding) => {
    const id = findingId(finding.path, finding.claim);
    carried.add(id);
    return priorFinding(id, finding, dismissed[id]?.note);
  });
  for (const [id, entry] of Object.entries(dismissed))
    if (!carried.has(id)) {
      carried.add(id);
      findings.push(priorFinding(id, entry.finding, entry.note));
    }
  for (const [id, finding] of Object.entries(open))
    if (!carried.has(id)) findings.push(priorFinding(id, finding, undefined));
  return findings;
}

function priorFinding(id: string, finding: Finding, note: string | undefined): PriorFinding {
  return {
    id,
    severity: finding.severity,
    claim: finding.claim,
    detail: finding.detail,
    ...(finding.path === undefined ? {} : { path: finding.path }),
    ...(finding.line === undefined ? {} : { line: finding.line }),
    ...(note === undefined ? {} : { dismissed: { note } }),
  };
}

export async function withdrawDismissal(
  directory: string,
  id: string,
): Promise<{ directory: string }> {
  const pullRequestDir = dirname(directory);
  const round = Number(basename(directory).slice(ROUND_PREFIX.length));
  const cleared: string[] = [];
  for (const name of (await listRounds(pullRequestDir))
    .filter((candidate) => Number(candidate.slice(ROUND_PREFIX.length)) <= round)
    .toReversed()) {
    const candidate = join(pullRequestDir, name);
    const dismissals = await readDismissals(candidate);
    if (!(id in dismissals)) continue;
    const { [id]: _withdrawn, ...remaining } = dismissals;
    await writeFile(join(candidate, "dismissed.json"), JSON.stringify(remaining, null, 2));
    cleared.push(candidate);
  }
  if (cleared.length > 0) return { directory: cleared[0]! };
  throw new Error(`no dismissal of ${id} in ${directory} or an earlier round`);
}

export async function dismissFinding(
  directory: string,
  id: string,
  reason: string,
): Promise<{ directory: string; dismissals: Dismissals }> {
  if (reason.trim() === "") throw new Error("a dismissal needs a reason");
  const { raisedIn, unreadable } = await roundThatRaised(directory, id);
  if (raisedIn === undefined)
    throw new Error(
      `no finding ${id} in ${directory} or an earlier round${unreadable.length === 0 ? "" : ` (unreadable result in ${unreadable.join(", ")})`}`,
    );
  const dismissals = { ...(await readDismissals(raisedIn)), [id]: reason };
  await writeFile(join(raisedIn, "dismissed.json"), JSON.stringify(dismissals, null, 2));
  return { directory: raisedIn, dismissals };
}

async function roundThatRaised(
  directory: string,
  id: string,
): Promise<{ raisedIn?: string; unreadable: string[] }> {
  const pullRequestDir = dirname(directory);
  const round = Number(basename(directory).slice(ROUND_PREFIX.length));
  const unreadable: string[] = [];
  for (const name of (await listRounds(pullRequestDir))
    .filter((candidate) => Number(candidate.slice(ROUND_PREFIX.length)) <= round)
    .toReversed()) {
    const candidate = join(pullRequestDir, name);
    const result = await readRoundResult(candidate).catch(() => {
      unreadable.push(candidate);
      return undefined;
    });
    if (result?.findings.some((finding) => findingId(finding.path, finding.claim) === id))
      return { raisedIn: candidate, unreadable };
  }
  return { unreadable };
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
    .toSorted(
      (a, b) => Number(a.slice(ROUND_PREFIX.length)) - Number(b.slice(ROUND_PREFIX.length)),
    );
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
