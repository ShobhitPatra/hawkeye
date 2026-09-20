import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { runner } from "./db/schema";

export type Runner = typeof runner.$inferSelect;

const TOKEN_PREFIX = "hk_";
const TOKEN_BYTES = 32;

function mintToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashRunnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseRunnerToken(authorization: string | null | undefined): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token, ...rest] = authorization.trim().split(/\s+/);
  if (rest.length > 0 || !token) return undefined;
  if (scheme?.toLowerCase() !== "bearer") return undefined;
  return token.startsWith(TOKEN_PREFIX) ? token : undefined;
}

const RUNNER_NAME_MAX_LENGTH = 64;
const RUNNER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

export function normalizeRunnerName(input: string): string {
  const name = input.trim();
  if (!name) throw new Error("a runner needs a name");
  if (name.length > RUNNER_NAME_MAX_LENGTH)
    throw new Error(`a runner name is at most ${RUNNER_NAME_MAX_LENGTH} characters`);
  if (!RUNNER_NAME.test(name))
    throw new Error("a runner name uses letters, digits, spaces, dots, underscores and dashes");
  return name;
}

export async function createRunnerToken(
  db: Db,
  input: { userId: string; name: string },
): Promise<{ runner: Runner; token: string }> {
  const name = normalizeRunnerName(input.name);
  const token = mintToken();
  const [row] = await db
    .insert(runner)
    .values({ userId: input.userId, name, tokenHash: hashRunnerToken(token) })
    .returning();
  if (!row) throw new Error(`failed to create a runner for user ${input.userId}`);
  return { runner: row, token };
}

export async function revokeRunnerToken(
  db: Db,
  input: { userId: string; runnerId: string },
): Promise<Runner | undefined> {
  const [row] = await db
    .update(runner)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(runner.id, input.runnerId), eq(runner.userId, input.userId), isNull(runner.revokedAt)),
    )
    .returning();
  return row;
}

export async function authenticateRunner(
  db: Db,
  authorization: string | null | undefined,
): Promise<Runner | undefined> {
  const token = parseRunnerToken(authorization);
  if (!token) return undefined;

  const now = new Date();
  const [row] = await db
    .update(runner)
    .set({ lastSeenAt: now, firstSeenAt: sql`coalesce(${runner.firstSeenAt}, ${now})` })
    .where(and(eq(runner.tokenHash, hashRunnerToken(token)), isNull(runner.revokedAt)))
    .returning();
  return row;
}

export function listRunners(db: Db, userId: string): Promise<Runner[]> {
  return db.select().from(runner).where(eq(runner.userId, userId)).orderBy(desc(runner.createdAt));
}
