import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, beforeAll } from "vitest";
import * as schema from "./schema";

async function expectUniqueViolation(promise: Promise<unknown>, indexName: string) {
  await expect(promise).rejects.toMatchObject({
    cause: expect.objectContaining({ message: expect.stringContaining(indexName) }),
  });
}

const migrationsFolder = join(import.meta.dirname, "..", "..", "drizzle");
let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
});

describe("schema migrations", () => {
  it("creates every table", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "armed_pr",
      "finding",
      "installation",
      "installation_user",
      "job",
      "review_posted",
      "run",
      "runner",
      "user_settings",
    ]);
  });
  it("allows one active armed pr per user and pull request", async () => {
    await db
      .insert(schema.installation)
      .values({ id: "1", accountLogin: "o", accountType: "User" });
    await db
      .insert(schema.armedPr)
      .values({ userId: "u", installationId: "1", owner: "o", repo: "r", number: 1 });
    await expectUniqueViolation(
      db
        .insert(schema.armedPr)
        .values({ userId: "u", installationId: "1", owner: "o", repo: "r", number: 1 }),
      "armed_pr_active_unique",
    );
    await db.update(schema.armedPr).set({ disarmedAt: new Date() });
    await db
      .insert(schema.armedPr)
      .values({ userId: "u", installationId: "1", owner: "o", repo: "r", number: 1 });
  });
  it("allows one queued job per armed pr but permits a queued job alongside a claimed one", async () => {
    await db
      .insert(schema.installation)
      .values({ id: "2", accountLogin: "o2", accountType: "User" });
    const returned = await db
      .insert(schema.armedPr)
      .values({ userId: "u", installationId: "2", owner: "o2", repo: "r2", number: 1 })
      .returning({ id: schema.armedPr.id });
    const armedPrId = returned[0]!.id;
    await db
      .insert(schema.job)
      .values({ armedPrId, headSha: "a", baseSha: "b", notBefore: new Date() });
    await expectUniqueViolation(
      db
        .insert(schema.job)
        .values({ armedPrId, headSha: "c", baseSha: "b", notBefore: new Date() }),
      "job_open_per_armed_pr",
    );
    await db.update(schema.job).set({ state: "claimed" });
    await db
      .insert(schema.job)
      .values({ armedPrId, headSha: "d", baseSha: "b", notBefore: new Date() });
    const jobs = await db.select().from(schema.job);
    expect(jobs).toHaveLength(2);
  });
});
