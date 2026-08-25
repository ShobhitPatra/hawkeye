import { randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import type { Db } from "./db/client";
import { runnerLogin } from "./db/schema";
import { createRunnerToken, hashRunnerToken } from "./runner-tokens";

export const RUNNER_LOGIN_TTL_MS = 10 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const DEVICE_SECRET_PREFIX = "hkd_";
const DEVICE_SECRET_BYTES = 32;
const RUNNER_NAME_MAX_LENGTH = 64;
const RUNNER_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export function normalizeRunnerName(input: string): string {
  const name = input.trim();
  if (!name) throw new Error("a runner needs a name");
  if (name.length > RUNNER_NAME_MAX_LENGTH)
    throw new Error(`a runner name is at most ${RUNNER_NAME_MAX_LENGTH} characters`);
  if (!RUNNER_NAME.test(name))
    throw new Error("a runner name uses letters, digits, spaces, dots, underscores and dashes");
  return name;
}

export type CollectRunnerLoginResult =
  | { status: "pending" }
  | { status: "approved"; token: string }
  | { status: "expired" };

function mintCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function mintDeviceSecret(): string {
  return `${DEVICE_SECRET_PREFIX}${randomBytes(DEVICE_SECRET_BYTES).toString("base64url")}`;
}

export async function sweepRunnerLogins(db: Db, now = new Date()): Promise<void> {
  await db.delete(runnerLogin).where(lte(runnerLogin.expiresAt, now));
}

export function formatRunnerLoginCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeRunnerLoginCode(input: string): string {
  const code = input
    .trim()
    .toUpperCase()
    .replace(/^([^-]{4})-/, "$1");
  if (code.length !== CODE_LENGTH || [...code].some((char) => !CODE_ALPHABET.includes(char)))
    throw new Error("a login code looks like XXXX-XXXX");
  return code;
}

export async function startRunnerLogin(
  db: Db,
  input: { runnerName: string; now?: Date },
): Promise<{ code: string; deviceSecret: string; expiresAt: Date }> {
  const runnerName = normalizeRunnerName(input.runnerName);
  const now = input.now ?? new Date();
  const code = mintCode();
  const deviceSecret = mintDeviceSecret();
  const expiresAt = new Date(now.getTime() + RUNNER_LOGIN_TTL_MS);
  await sweepRunnerLogins(db, now);
  await db.insert(runnerLogin).values({
    code,
    deviceSecretHash: hashRunnerToken(deviceSecret),
    runnerName,
    expiresAt,
    createdAt: now,
  });
  return { code, deviceSecret, expiresAt };
}

export type RunnerLoginSummary = {
  runnerName: string;
  createdAt: Date;
  state: "pending" | "approved" | "expired";
};

export async function findRunnerLogin(
  db: Db,
  input: { code: string; now?: Date },
): Promise<RunnerLoginSummary | undefined> {
  const now = input.now ?? new Date();
  let code: string;
  try {
    code = normalizeRunnerLoginCode(input.code);
  } catch {
    return undefined;
  }
  const [login] = await db.select().from(runnerLogin).where(eq(runnerLogin.code, code));
  if (!login) return undefined;
  const state = login.approvedAt
    ? "approved"
    : login.expiresAt.getTime() <= now.getTime()
      ? "expired"
      : "pending";
  return { runnerName: login.runnerName, createdAt: login.createdAt, state };
}

export async function approveRunnerLogin(
  db: Db,
  input: { userId: string; code: string; now?: Date },
): Promise<{ runnerName: string }> {
  const now = input.now ?? new Date();
  const code = normalizeRunnerLoginCode(input.code);
  const [claimed] = await db
    .update(runnerLogin)
    .set({ approvedAt: now, userId: input.userId })
    .where(
      and(
        eq(runnerLogin.code, code),
        isNull(runnerLogin.approvedAt),
        gt(runnerLogin.expiresAt, now),
      ),
    )
    .returning({ runnerName: runnerLogin.runnerName });
  if (claimed) return claimed;
  const [login] = await db.select().from(runnerLogin).where(eq(runnerLogin.code, code));
  if (!login) throw new Error("unknown login code");
  if (login.approvedAt) throw new Error("this login code was already approved");
  throw new Error("this login code has expired");
}

export async function collectRunnerLogin(
  db: Db,
  input: { deviceSecret: string; now?: Date },
): Promise<CollectRunnerLoginResult> {
  const now = input.now ?? new Date();
  const secretHash = hashRunnerToken(input.deviceSecret);
  return db.transaction(async (tx) => {
    const [login] = await tx
      .select()
      .from(runnerLogin)
      .where(eq(runnerLogin.deviceSecretHash, secretHash))
      .for("update");
    if (!login || login.collectedAt) return { status: "expired" };
    if (login.expiresAt.getTime() <= now.getTime()) {
      await tx.delete(runnerLogin).where(eq(runnerLogin.id, login.id));
      return { status: "expired" };
    }
    if (!login.approvedAt || !login.userId) return { status: "pending" };
    const { runner, token } = await createRunnerToken(tx, {
      userId: login.userId,
      name: login.runnerName,
    });
    await tx
      .update(runnerLogin)
      .set({ runnerId: runner.id, collectedAt: now })
      .where(eq(runnerLogin.id, login.id));
    return { status: "approved", token };
  });
}
