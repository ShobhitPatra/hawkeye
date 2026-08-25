import { type Finding, findingId } from "@hawkeye/core";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { recordFindings } from "./findings";
import { enqueueJob } from "./jobs";
import { createTestDb, seedArmedPullRequest } from "./test/pglite";

const firstHead = "a".repeat(40);
const secondHead = "b".repeat(40);
const thirdHead = "c".repeat(40);
const anchored: Finding = {
  path: "a.txt",
  line: 2,
  severity: "should_fix",
  claim: "Anchored claim",
  detail: "d",
};
const unanchored: Finding = { severity: "must_fix", claim: "Unanchored claim", detail: "d" };

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await seedArmedPullRequest(db);
});

const record = (headSha: string, findings: Finding[]) =>
  recordFindings(db, { armedPrId: "armed-1", headSha, findings });

const rows = () => db.select().from(schema.finding).where(eq(schema.finding.armedPrId, "armed-1"));

describe("recordFindings", () => {
  it("creates a row per finding with the head as first seen", async () => {
    await expect(record(firstHead, [anchored, unanchored])).resolves.toEqual({
      created: 2,
      updated: 0,
      resolved: 0,
    });

    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(
      stored.find((row) => row.stableId === findingId("a.txt", "Anchored claim")),
    ).toMatchObject({
      severity: "should_fix",
      claim: "Anchored claim",
      path: "a.txt",
      line: 2,
      firstSeenSha: firstHead,
      resolvedSha: null,
      githubCommentId: null,
    });
    expect(
      stored.find((row) => row.stableId === findingId(undefined, "Unanchored claim")),
    ).toMatchObject({ path: null, line: null, firstSeenSha: firstHead });
  });

  it("keeps first seen and updates line and severity when a finding recurs", async () => {
    await record(firstHead, [anchored]);

    await expect(
      record(secondHead, [{ ...anchored, line: 5, severity: "must_fix" }]),
    ).resolves.toEqual({ created: 0, updated: 1, resolved: 0 });

    const [row] = await rows();
    expect(row).toMatchObject({
      line: 5,
      severity: "must_fix",
      firstSeenSha: firstHead,
      resolvedSha: null,
    });
  });

  it("resolves a finding missing from the next result at that head", async () => {
    await record(firstHead, [anchored, unanchored]);

    await expect(record(secondHead, [anchored])).resolves.toEqual({
      created: 0,
      updated: 1,
      resolved: 1,
    });

    const stored = await rows();
    expect(stored.find((row) => row.path === null)?.resolvedSha).toBe(secondHead);
    expect(stored.find((row) => row.path === "a.txt")?.resolvedSha).toBeNull();
  });

  it("reopens a resolved finding that returns", async () => {
    await record(firstHead, [anchored]);
    await record(secondHead, []);

    await expect(record(thirdHead, [anchored])).resolves.toEqual({
      created: 0,
      updated: 1,
      resolved: 0,
    });

    const [row] = await rows();
    expect(row).toMatchObject({ firstSeenSha: firstHead, resolvedSha: null });
  });

  it("collapses duplicate stable ids in one result to the first occurrence", async () => {
    await expect(
      record(firstHead, [anchored, { ...anchored, line: 9, severity: "inherited" }]),
    ).resolves.toEqual({ created: 1, updated: 0, resolved: 0 });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ line: 2, severity: "should_fix" });
  });

  it("resolves every open finding on an empty result", async () => {
    await record(firstHead, [anchored, unanchored]);

    await expect(record(secondHead, [])).resolves.toEqual({
      created: 0,
      updated: 0,
      resolved: 2,
    });

    for (const row of await rows()) expect(row.resolvedSha).toBe(secondHead);
  });
  it("reports superseded when a newer job for the pull request is done", async () => {
    const older = await enqueueJob(db, {
      armedPrId: "armed-1",
      headSha: firstHead,
      baseSha: "b".repeat(40),
      notBefore: new Date(),
    });
    await db.update(schema.job).set({ state: "done" }).where(eq(schema.job.id, older.id));
    const newer = await enqueueJob(db, {
      armedPrId: "armed-1",
      headSha: secondHead,
      baseSha: "b".repeat(40),
      notBefore: new Date(),
    });
    await expect(
      recordFindings(db, {
        armedPrId: "armed-1",
        headSha: firstHead,
        findings: [anchored],
        jobId: older.id,
      }),
    ).resolves.toEqual({ created: 1, updated: 0, resolved: 0 });

    await db.update(schema.job).set({ state: "done" }).where(eq(schema.job.id, newer.id));
    await expect(
      recordFindings(db, {
        armedPrId: "armed-1",
        headSha: firstHead,
        findings: [],
        jobId: older.id,
      }),
    ).resolves.toBe("superseded");
    expect((await rows())[0]?.resolvedSha).toBeNull();
  });
});
