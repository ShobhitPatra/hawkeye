import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./db/schema";
import { createTestDb } from "./test/pglite";

describe("Better Auth on the migrated schema", () => {
  it("creates a GitHub user and account without an issuer", async () => {
    const db = await createTestDb();
    const auth = betterAuth({
      database: drizzleAdapter(db, { provider: "pg", schema }),
      secret: "a-test-secret-that-is-at-least-thirty-two-characters",
      baseURL: "http://localhost:3000",
      user: { additionalFields: { githubLogin: { type: "string", required: false } } },
    });
    const context = await auth.$context;
    const { user, account } = await context.internalAdapter.createOAuthUser(
      { name: "octocat", email: "octo@example.com", emailVerified: true },
      { providerId: "github", accountId: "583231" },
    );
    const [row] = await db.select().from(schema.account).where(eq(schema.account.id, account.id));
    expect(row).toMatchObject({
      providerId: "github",
      accountId: "583231",
      userId: user.id,
      issuer: null,
    });
  });
});
