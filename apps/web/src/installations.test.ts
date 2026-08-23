import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import type { WebhookEvent } from "./github/webhook-events";
import { linkInstallationToUser, recordInstallation } from "./installations";

type InstallationEvent = Extract<WebhookEvent, { type: "installation" }>;

function installationEvent(action: InstallationEvent["action"], senderId = 500): InstallationEvent {
  return {
    type: "installation",
    action,
    installation: { id: 42, account: { login: "octo", type: "Organization" } },
    sender: { id: senderId, login: "octocat" },
  };
}

const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
let db: Db;

beforeAll(async () => {
  const pglite = drizzle(new PGlite(), { schema });
  await migrate(pglite, { migrationsFolder });
  db = pglite;
});

async function readInstallation() {
  const [row] = await db.select().from(schema.installation).where(eq(schema.installation.id, "42"));
  return row;
}

describe("recordInstallation", () => {
  it("inserts an installation on created, soft-deletes it, and revives it", async () => {
    await recordInstallation(db, installationEvent("created"));
    expect(await readInstallation()).toMatchObject({
      accountLogin: "octo",
      accountType: "Organization",
      deletedAt: null,
    });

    await recordInstallation(db, installationEvent("deleted"));
    expect((await readInstallation())?.deletedAt).toBeInstanceOf(Date);

    await recordInstallation(db, installationEvent("created"));
    expect((await readInstallation())?.deletedAt).toBeNull();
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
    await recordInstallation(db, installationEvent("created", 700));

    const links = await db.select().from(schema.installationUser);
    expect(links).toEqual([{ installationId: "42", userId: "user-1" }]);
  });

  it("does nothing when no account matches the sender", async () => {
    await recordInstallation(db, installationEvent("created", 999));
    await linkInstallationToUser(db, "42", 999);

    const links = await db.select().from(schema.installationUser);
    expect(links).toEqual([{ installationId: "42", userId: "user-1" }]);
  });
});
