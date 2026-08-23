import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
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

export async function createRunnerToken(
  db: Db,
  input: { userId: string; name: string },
): Promise<{ runner: Runner; token: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("a runner needs a name");

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

  const [row] = await db
    .update(runner)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(runner.tokenHash, hashRunnerToken(token)), isNull(runner.revokedAt)))
    .returning();
  return row;
}

export function listRunners(db: Db, userId: string): Promise<Runner[]> {
  return db.select().from(runner).where(eq(runner.userId, userId)).orderBy(desc(runner.createdAt));
}
