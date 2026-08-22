import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, beforeAll } from "vitest";

const migrationsFolder = join(import.meta.dirname, "..", "..", "drizzle");
let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  const db = drizzle(client);
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
    await client.exec(
      "insert into installation (id, account_login, account_type) values ('1', 'o', 'User')",
    );
    await client.exec(
      "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
    );
    await expect(
      client.exec(
        "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
      ),
    ).rejects.toThrow(/armed_pr_active_unique/);
    await client.exec("update armed_pr set disarmed_at = now()");
    await client.exec(
      "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '1', 'o', 'r', 1)",
    );
  });
  it("allows one queued job per armed pr but permits a queued job alongside a claimed one", async () => {
    await client.exec(
      "insert into installation (id, account_login, account_type) values ('2', 'o2', 'User')",
    );
    const { rows } = await client.query<{ id: string }>(
      "insert into armed_pr (user_id, installation_id, owner, repo, number) values ('u', '2', 'o2', 'r2', 1) returning id",
    );
    const armedPrId = rows[0]!.id;
    await client.exec(
      `insert into job (armed_pr_id, head_sha, base_sha, not_before) values ('${armedPrId}', 'a', 'b', now())`,
    );
    await expect(
      client.exec(
        `insert into job (armed_pr_id, head_sha, base_sha, not_before) values ('${armedPrId}', 'c', 'b', now())`,
      ),
    ).rejects.toThrow(/job_open_per_armed_pr/);
    await client.exec("update job set state = 'claimed'");
    await client.exec(
      `insert into job (armed_pr_id, head_sha, base_sha, not_before) values ('${armedPrId}', 'd', 'b', now())`,
    );
  });
});
