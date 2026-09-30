import { describe, expect, it, vi } from "vitest";
import { type InstalledOnDeps, readInstalledOn } from "./installed-on";

const installation = (
  id: string,
  accountLogin: string,
  accountType: string,
  extra: Partial<{ suspended: boolean; repositorySelection: "all" | "selected" }> = {},
) => ({
  id,
  accountLogin,
  accountType,
  suspended: false,
  repositorySelection: "all" as const,
  ...extra,
});

function deps(
  installations: ReturnType<typeof installation>[],
  repositories: Record<string, { total: number; names: string[] }> = {},
) {
  const github = {
    listUserInstallations: vi.fn(async () => installations),
    listUserInstallationRepositories: vi.fn(async (_token: string, id: string) => ({
      total: repositories[id]!.total,
      repositories: repositories[id]!.names.map((name) => ({
        owner: "octo",
        name,
        fullName: `octo/${name}`,
        private: true,
      })),
    })),
    appSlug: vi.fn(async () => "hawkeye-review"),
  };
  const result: InstalledOnDeps = { github, token: async () => "gho_user", cache: new Map() };
  return { github, deps: result };
}

describe("readInstalledOn", () => {
  it("lists the personal account first, then organisations, with the App's install link", async () => {
    const { deps: d } = deps([
      installation("2", "zeta-org", "Organization"),
      installation("1", "sam", "User"),
      installation("3", "acme", "Organization"),
    ]);
    const installed = await readInstalledOn(d, { userId: "u1", login: "sam" });
    expect(installed.accounts.map((account) => account.login)).toEqual(["sam", "acme", "zeta-org"]);
    expect(installed.installUrl).toBe("https://github.com/apps/hawkeye-review/installations/new");
  });
  it("offers Manage on GitHub only for the signed-in user's own account", async () => {
    const { deps: d } = deps([
      installation("1", "sam", "User"),
      installation("2", "acme", "Organization"),
      installation("4", "someone-else", "User"),
    ]);
    const installed = await readInstalledOn(d, { userId: "u1", login: "sam" });
    expect(installed.accounts.map((account) => account.manageUrl)).toEqual([
      "https://github.com/settings/installations/1",
      undefined,
      undefined,
    ]);
  });
  it("names the repositories of a selected installation with the user's token, and counts the rest", async () => {
    const { deps: d, github } = deps(
      [installation("2", "acme", "Organization", { repositorySelection: "selected" })],
      { "2": { total: 11, names: ["api", "web"] } },
    );
    const [account] = (await readInstalledOn(d, { userId: "u1", login: "sam" })).accounts;
    expect(account).toMatchObject({ state: "selected", repositories: ["api", "web"], more: 9 });
    expect(github.listUserInstallationRepositories).toHaveBeenCalledWith("gho_user", "2", 8);
  });
  it("asks for no repositories when the installation covers all of them or is suspended", async () => {
    const { deps: d, github } = deps([
      installation("1", "sam", "User"),
      installation("2", "acme", "Organization", {
        suspended: true,
        repositorySelection: "selected",
      }),
    ]);
    const installed = await readInstalledOn(d, { userId: "u1", login: "sam" });
    expect(installed.accounts.map((account) => account.state)).toEqual(["all", "suspended"]);
    expect(github.listUserInstallationRepositories).not.toHaveBeenCalled();
  });
  it("holds the answer for ten minutes per user", async () => {
    const { deps: d, github } = deps([installation("1", "sam", "User")]);
    await readInstalledOn(d, { userId: "u1", login: "sam", now: 0 });
    await readInstalledOn(d, { userId: "u1", login: "sam", now: 9 * 60_000 });
    expect(github.listUserInstallations).toHaveBeenCalledTimes(1);
    await readInstalledOn(d, { userId: "u1", login: "sam", now: 11 * 60_000 });
    expect(github.listUserInstallations).toHaveBeenCalledTimes(2);
  });
});
