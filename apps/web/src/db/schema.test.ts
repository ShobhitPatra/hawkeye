import { RUN_RESULT_STATUSES, SEVERITIES } from "@hawkeye/core";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { describe, expect, it, beforeAll } from "vitest";
import * as schema from "./schema";

async function insertUser(id: string) {
  await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
}

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
      "account",
      "armed_pr",
      "finding",
      "installation",
      "installation_user",
      "job",
      "review_posted",
      "run",
      "runner",
      "runner_login",
      "session",
      "user",
      "user_settings",
      "verification",
    ]);
  });
  it("stores the github login on the user", async () => {
    await db
      .insert(schema.user)
      .values({ id: "u-login", name: "octocat", email: "octocat@example.com" });
    const [withoutLogin] = await db.select().from(schema.user).where(eq(schema.user.id, "u-login"));
    expect(withoutLogin?.githubLogin).toBeNull();

    await db
      .update(schema.user)
      .set({ githubLogin: "octocat" })
      .where(eq(schema.user.id, "u-login"));
    const [withLogin] = await db.select().from(schema.user).where(eq(schema.user.id, "u-login"));
    expect(withLogin?.githubLogin).toBe("octocat");
  });
  it("rejects an armed pr for an unknown user and accepts it once the user exists", async () => {
    await db
      .insert(schema.installation)
      .values({ id: "0", accountLogin: "o0", accountType: "User" });
    await expect(
      db
        .insert(schema.armedPr)
        .values({ userId: "ghost", installationId: "0", owner: "o0", repo: "r0", number: 1 }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringContaining("armed_pr_user_id_user_id_fk"),
      }),
    });
    await insertUser("ghost");
    await db
      .insert(schema.armedPr)
      .values({ userId: "ghost", installationId: "0", owner: "o0", repo: "r0", number: 1 });
  });
  it("allows one active armed pr per user and pull request", async () => {
    await insertUser("u");
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
  it("round-trips every remaining table through the Drizzle objects", async () => {
    await insertUser("u3");
    await db
      .insert(schema.installation)
      .values({ id: "3", accountLogin: "o3", accountType: "User" });
    const [selectedInstallation] = await db
      .select()
      .from(schema.installation)
      .where(eq(schema.installation.id, "3"));
    expect(selectedInstallation).toMatchObject({
      id: "3",
      accountLogin: "o3",
      accountType: "User",
      deletedAt: null,
    });
    expect(selectedInstallation?.createdAt).toBeInstanceOf(Date);

    const armedPrReturned = await db
      .insert(schema.armedPr)
      .values({ userId: "u3", installationId: "3", owner: "o3", repo: "r3", number: 1 })
      .returning();
    const armedPrId = armedPrReturned[0]!.id;

    const [selectedArmedPr] = await db
      .select()
      .from(schema.armedPr)
      .where(eq(schema.armedPr.id, armedPrId));
    expect(selectedArmedPr).toMatchObject({
      id: armedPrId,
      userId: "u3",
      installationId: "3",
      owner: "o3",
      repo: "r3",
      number: 1,
      quietWindowSeconds: null,
      disarmedAt: null,
    });
    expect(selectedArmedPr?.armedAt).toBeInstanceOf(Date);

    const jobReturned = await db
      .insert(schema.job)
      .values({ armedPrId, headSha: "a3", baseSha: "b3", notBefore: new Date() })
      .returning({ id: schema.job.id });
    const jobId = jobReturned[0]!.id;

    const runnerReturned = await db
      .insert(schema.runner)
      .values({ id: "runner-3", userId: "u3", name: "runner-3", tokenHash: "hash-3" })
      .returning();
    expect(runnerReturned[0]).toMatchObject({
      id: "runner-3",
      userId: "u3",
      name: "runner-3",
      tokenHash: "hash-3",
    });
    const [selectedRunner] = await db
      .select()
      .from(schema.runner)
      .where(eq(schema.runner.id, "runner-3"));
    expect(selectedRunner).toMatchObject({
      id: "runner-3",
      userId: "u3",
      name: "runner-3",
      tokenHash: "hash-3",
    });

    const runReturned = await db
      .insert(schema.run)
      .values({ jobId, runnerId: "runner-3", turns: 3 })
      .returning({ id: schema.run.id });
    const runId = runReturned[0]!.id;
    const [selectedRun] = await db.select().from(schema.run).where(eq(schema.run.id, runId));
    expect(selectedRun).toMatchObject({ id: runId, jobId, runnerId: "runner-3", turns: 3 });

    await db.insert(schema.finding).values({
      armedPrId,
      stableId: "finding-3",
      severity: "must_fix",
      claim: "claim-3",
      detail: "detail-3",
      firstSeenSha: "a3",
    });
    const [selectedFinding] = await db
      .select()
      .from(schema.finding)
      .where(eq(schema.finding.stableId, "finding-3"));
    expect(selectedFinding).toMatchObject({
      armedPrId,
      stableId: "finding-3",
      severity: "must_fix",
      claim: "claim-3",
      detail: "detail-3",
      firstSeenSha: "a3",
    });

    await db
      .insert(schema.reviewPosted)
      .values({ runId, armedPrId, headSha: "a3", githubReviewId: "gh-review-3" });
    const [selectedReviewPosted] = await db
      .select()
      .from(schema.reviewPosted)
      .where(eq(schema.reviewPosted.runId, runId));
    expect(selectedReviewPosted).toMatchObject({
      runId,
      armedPrId,
      headSha: "a3",
      githubReviewId: "gh-review-3",
    });

    await db.insert(schema.userSettings).values({ userId: "u3" });
    const [selectedUserSettings] = await db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, "u3"));
    expect(selectedUserSettings).toMatchObject({
      userId: "u3",
      maxTurns: 40,
      wallClockMinutes: 15,
      quietWindowSeconds: 0,
      reviewDrafts: false,
    });

    await db.insert(schema.installationUser).values({ installationId: "3", userId: "u3" });
    const [selectedInstallationUser] = await db
      .select()
      .from(schema.installationUser)
      .where(eq(schema.installationUser.installationId, "3"));
    expect(selectedInstallationUser).toMatchObject({ installationId: "3", userId: "u3" });

    await db.insert(schema.session).values({
      id: "session-3",
      expiresAt: new Date(),
      token: "token-3",
      userId: "u3",
    });
    const [selectedSession] = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, "session-3"));
    expect(selectedSession).toMatchObject({ id: "session-3", token: "token-3", userId: "u3" });

    await db.insert(schema.account).values({
      id: "account-3",
      issuer: "https://github.com",
      accountId: "gh-3",
      providerId: "github",
      userId: "u3",
    });
    const [selectedAccount] = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, "account-3"));
    expect(selectedAccount).toMatchObject({
      id: "account-3",
      issuer: "https://github.com",
      accountId: "gh-3",
      providerId: "github",
      userId: "u3",
    });

    await db.insert(schema.verification).values({
      id: "verification-3",
      identifier: "u3",
      value: "code-3",
      expiresAt: new Date(),
    });
    const [selectedVerification] = await db
      .select()
      .from(schema.verification)
      .where(eq(schema.verification.id, "verification-3"));
    expect(selectedVerification).toMatchObject({
      id: "verification-3",
      identifier: "u3",
      value: "code-3",
    });
  });
});

describe("run status enum", () => {
  it("matches core's run result statuses plus running", () => {
    expect(schema.runStatus.enumValues).toEqual(["running", ...RUN_RESULT_STATUSES]);
  });
});

describe("finding severity enum", () => {
  it("matches core's severities in the schema and in the migrated database", async () => {
    expect(schema.findingSeverity.enumValues).toEqual([...SEVERITIES]);
    const { rows } = await client.query<{ label: string }>(
      "select enumlabel as label from pg_enum join pg_type on pg_type.oid = enumtypid where typname = 'finding_severity' order by enumsortorder",
    );
    expect(rows.map((row) => row.label)).toEqual([...SEVERITIES]);
  });
});

describe("timestamps", () => {
  it("uses timestamptz for every timestamp column in every table", async () => {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type = 'timestamp without time zone'",
    );
    expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([]);
  });
});
