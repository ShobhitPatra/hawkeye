import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { syncInstallationsForUser } from "./installation-sync";
import { installationBelongsToUser } from "./installations";
import { createTestDb } from "./test/pglite";

let db: Db;
const getAccessToken = vi.fn(async () => ({ accessToken: "gho_fresh" }));
const listUserInstallations = vi.fn(async () => [
  { id: "900", accountLogin: "octo", accountType: "Organization", suspended: false },
]);
const deps = () => ({
  auth: { api: { getAccessToken } } as unknown as Parameters<
    typeof syncInstallationsForUser
  >[0]["auth"],
  db,
  github: { listUserInstallations },
});

beforeAll(async () => {
  db = await createTestDb();
  await db.insert(schema.user).values([
    { id: "u-1", name: "octocat", email: "o@example.com" },
    { id: "u-2", name: "nobody", email: "n@example.com" },
  ]);
  await db.insert(schema.account).values({
    id: "account-1",
    issuer: "https://github.com",
    accountId: "42",
    providerId: "github",
    userId: "u-1",
  });
});

describe("syncInstallationsForUser", () => {
  it("resolves a fresh token for the user's GitHub account and syncs with it", async () => {
    const headers = new Headers({ cookie: "session=abc" });
    await expect(syncInstallationsForUser(deps(), "u-1", headers)).resolves.toEqual({
      linked: 1,
      unlinked: 0,
    });
    expect(getAccessToken).toHaveBeenCalledWith({
      body: { accountId: "account-1", userId: "u-1" },
      headers,
    });
    expect(listUserInstallations).toHaveBeenCalledWith("gho_fresh");
    expect(await installationBelongsToUser(db, "900", "u-1")).toBe(true);
  });

  it("throws when the user has no GitHub account", async () => {
    await expect(syncInstallationsForUser(deps(), "u-2")).rejects.toThrow(
      "user u-2 has no GitHub account",
    );
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});
