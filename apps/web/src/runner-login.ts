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
  const runnerName = input.runnerName.trim();
  if (!runnerName) throw new Error("a runner needs a name");
  const now = input.now ?? new Date();
  const code = mintCode();
  const deviceSecret = mintDeviceSecret();
  const expiresAt = new Date(now.getTime() + RUNNER_LOGIN_TTL_MS);
  await db.delete(runnerLogin).where(lte(runnerLogin.expiresAt, now));
  await db.insert(runnerLogin).values({
    code,
    deviceSecretHash: hashRunnerToken(deviceSecret),
    runnerName,
    expiresAt,
    createdAt: now,
  });
  return { code, deviceSecret, expiresAt };
}

export async function findRunnerLogin(
  db: Db,
  input: { code: string; now?: Date },
): Promise<{ runnerName: string; createdAt: Date; state: "pending" | "approved" | "expired" }> {
  const now = input.now ?? new Date();
  const code = normalizeRunnerLoginCode(input.code);
  const [login] = await db.select().from(runnerLogin).where(eq(runnerLogin.code, code));
  if (!login) throw new Error("unknown login code");
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
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(runnerLogin)
      .set({ approvedAt: now, userId: input.userId })
      .where(
        and(
          eq(runnerLogin.code, code),
          isNull(runnerLogin.approvedAt),
          gt(runnerLogin.expiresAt, now),
        ),
      )
      .returning();
    if (!claimed) {
      const [login] = await tx.select().from(runnerLogin).where(eq(runnerLogin.code, code));
      if (!login) throw new Error("unknown login code");
      if (login.approvedAt) throw new Error("this login code was already approved");
      throw new Error("this login code has expired");
    }
    const { runner, token } = await createRunnerToken(tx, {
      userId: input.userId,
      name: claimed.runnerName,
    });
    await tx
      .update(runnerLogin)
      .set({ runnerId: runner.id, token })
      .where(eq(runnerLogin.id, claimed.id));
    return { runnerName: runner.name };
  });
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
    if (!login) return { status: "expired" };
    if (login.token) {
      await tx
        .update(runnerLogin)
        .set({ token: null, collectedAt: now })
        .where(eq(runnerLogin.id, login.id));
      return { status: "approved", token: login.token };
    }
    if (login.approvedAt || login.expiresAt.getTime() <= now.getTime())
      return { status: "expired" };
    return { status: "pending" };
  });
}
