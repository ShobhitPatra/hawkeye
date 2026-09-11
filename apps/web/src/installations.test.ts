import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { WebhookEvent } from "./github/webhook-events";
import {
  installationBelongsToUser,
  syncUserInstallations,
  linkInstallationToUser,
  recordInstallation,
} from "./installations";
import { createTestDb } from "./test/pglite";

type InstallationEvent = Extract<WebhookEvent, { type: "installation" }>;

function installationEvent(
  action: InstallationEvent["action"],
  installationId: number,
  senderId: number,
): InstallationEvent {
  return {
    type: "installation",
    action,
    installation: { id: installationId, account: { login: "octo", type: "Organization" } },
    sender: { id: senderId, login: "octocat" },
  };
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

async function readInstallation(id: string) {
  const [row] = await db.select().from(schema.installation).where(eq(schema.installation.id, id));
  return row;
}

function readLinks(installationId: string) {
  return db
    .select()
    .from(schema.installationUser)
    .where(eq(schema.installationUser.installationId, installationId));
}

describe("recordInstallation", () => {
  it("inserts an installation on created, soft-deletes it, and revives it", async () => {
    await recordInstallation(db, installationEvent("created", 42, 500));
    expect(await readInstallation("42")).toMatchObject({
      accountLogin: "octo",
      accountType: "Organization",
      deletedAt: null,
    });

    await recordInstallation(db, installationEvent("deleted", 42, 500));
    expect((await readInstallation("42"))?.deletedAt).toBeInstanceOf(Date);

    await recordInstallation(db, installationEvent("created", 42, 500));
    expect((await readInstallation("42"))?.deletedAt).toBeNull();
  });

  it("soft-deletes on suspend and revives on unsuspend", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-2", name: "octocat", email: "octocat2@example.com" });
    await db.insert(schema.account).values({
      id: "account-2",
      issuer: "https://github.com",
      accountId: "501",
      providerId: "github",
      userId: "user-2",
    });

    await recordInstallation(db, installationEvent("created", 43, 501));
    expect((await readInstallation("43"))?.deletedAt).toBeNull();

    await recordInstallation(db, installationEvent("suspend", 43, 501));
    expect((await readInstallation("43"))?.deletedAt).toBeInstanceOf(Date);

    await recordInstallation(db, installationEvent("unsuspend", 43, 501));
    expect((await readInstallation("43"))?.deletedAt).toBeNull();
    expect(await readLinks("43")).toEqual([{ installationId: "43", userId: "user-2" }]);
  });
});

describe("linkInstallationToUser", () => {
  it("links the installation to the user owning the github account", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-1", name: "octocat", email: "octocat@example.com" });
    await db.insert(schema.account).values({
      id: "account-1",
      issuer: "https://github.com",
      accountId: "700",
      providerId: "github",
      userId: "user-1",
    });
    await recordInstallation(db, installationEvent("created", 70, 700));

    expect(await readLinks("70")).toEqual([{ installationId: "70", userId: "user-1" }]);
  });

  it("does nothing when no account matches the sender", async () => {
    await recordInstallation(db, installationEvent("created", 99, 999));
    await linkInstallationToUser(db, "99", 999);

    expect(await readLinks("99")).toHaveLength(0);
  });
});

describe("installationBelongsToUser", () => {
  it("is true only for an installation linked to the user", async () => {
    await db
      .insert(schema.user)
      .values({ id: "user-3", name: "hubot", email: "hubot@example.com" });
    await db.insert(schema.account).values({
      id: "account-3",
      issuer: "https://github.com",
      accountId: "800",
      providerId: "github",
      userId: "user-3",
    });
    await recordInstallation(db, installationEvent("created", 80, 800));

    expect(await installationBelongsToUser(db, "80", "user-3")).toBe(true);
    expect(await installationBelongsToUser(db, "80", "user-1")).toBe(false);
    expect(await installationBelongsToUser(db, "81", "user-3")).toBe(false);
  });
  it("is false once the installation is deleted or suspended", async () => {
    await recordInstallation(db, installationEvent("suspend", 80, 800));
    expect(await installationBelongsToUser(db, "80", "user-3")).toBe(false);
    await recordInstallation(db, installationEvent("unsuspend", 80, 800));
    expect(await installationBelongsToUser(db, "80", "user-3")).toBe(true);
  });
});

describe("syncUserInstallations", () => {
  const listUserInstallations = vi.fn();
  const github = { listUserInstallations };

  beforeAll(async () => {
    await db.insert(schema.user).values({ id: "u-sync", name: "sam", email: "sam@example.com" });
  });

  it("links every accessible installation, upserting ones the webhook never delivered", async () => {
    listUserInstallations.mockResolvedValueOnce([
      { id: "500", accountLogin: "octo", accountType: "Organization" },
      { id: "501", accountLogin: "sam", accountType: "User" },
    ]);
    await expect(
      syncUserInstallations(db, github, { userId: "u-sync", token: "gho_x" }),
    ).resolves.toEqual({ linked: 2, unlinked: 0 });
    expect(listUserInstallations).toHaveBeenCalledWith("gho_x");
    expect(await readInstallation("501")).toMatchObject({ accountLogin: "sam", deletedAt: null });
    expect(await installationBelongsToUser(db, "500", "u-sync")).toBe(true);
    expect(await installationBelongsToUser(db, "501", "u-sync")).toBe(true);
  });

  it("unlinks installations the account can no longer reach and keeps the rest", async () => {
    listUserInstallations.mockResolvedValueOnce([
      { id: "500", accountLogin: "octo", accountType: "Organization" },
    ]);
    await expect(
      syncUserInstallations(db, github, { userId: "u-sync", token: "gho_x" }),
    ).resolves.toEqual({ linked: 0, unlinked: 1 });
    expect(await installationBelongsToUser(db, "500", "u-sync")).toBe(true);
    expect(await installationBelongsToUser(db, "501", "u-sync")).toBe(false);
    expect(await readInstallation("501")).toMatchObject({ deletedAt: null });
  });

  it("unlinks everything when the account can reach no installation", async () => {
    listUserInstallations.mockResolvedValueOnce([]);
    await expect(
      syncUserInstallations(db, github, { userId: "u-sync", token: "gho_x" }),
    ).resolves.toEqual({ linked: 0, unlinked: 1 });
    expect(await installationBelongsToUser(db, "500", "u-sync")).toBe(false);
  });
});
