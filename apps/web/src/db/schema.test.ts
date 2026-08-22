import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, beforeAll } from "vitest";

const migrationsDirectory = join(import.meta.dirname, "..", "..", "drizzle");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const files = (await readdir(migrationsDirectory)).filter((f) => f.endsWith(".sql")).toSorted();
  for (const file of files) {
    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) await db.exec(statement);
  }
});

describe("schema migrations", () => {
  it("creates every table", async () => {
    const { rows } = await db.query<{ table_name: string }>(
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
    await db.exec(
      "insert into installation (id, account_login, account_type) values ('1', 'o', 'User')",
    );
    await db.exec(
      "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
    );
    await expect(
      db.exec(
        "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
      ),
    ).rejects.toThrow(/armed_pr_active_unique/);
    await db.exec("update armed_pr set disarmed_at = now()");
    await db.exec(
      "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
    );
  });
  it("allows one open job per armed pr", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from armed_pr where disarmed_at is null",
    );
    const armedPrId = rows[0]!.id;
    await db.exec(
      `insert into job (armed_pr_id, head_sha, base_sha, not_before) values ('${armedPrId}', 'a', 'b', now())`,
    );
    await expect(
      db.exec(
        `insert into job (armed_pr_id, head_sha, base_sha, not_before) values ('${armedPrId}', 'c', 'b', now())`,
      ),
    ).rejects.toThrow(/job_open_per_armed_pr/);
  });
});
