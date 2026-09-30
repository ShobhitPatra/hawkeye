import type { GitHubClient } from "@hawkeye/core";
import { hold, type HoldStore } from "./hold";

export const NAMED_REPOSITORIES = 8;
const INSTALLED_ON_TTL_MS = 10 * 60_000;

export type InstalledAccount = {
  id: string;
  login: string;
  state: "all" | "selected" | "suspended";
  repositories: string[];
  more: number;
  manageUrl?: string;
};

export type InstalledOn = { accounts: InstalledAccount[]; installUrl: string };

export type InstalledOnDeps = {
  github: Pick<
    GitHubClient,
    "listUserInstallations" | "listUserInstallationRepositories" | "appSlug"
  >;
  token(): Promise<string>;
  cache?: HoldStore<InstalledOn>;
};

const held: HoldStore<InstalledOn> = new Map();

export function readInstalledOn(
  deps: InstalledOnDeps,
  input: { userId: string; login: string | undefined; now?: number },
): Promise<InstalledOn> {
  return hold(
    deps.cache ?? held,
    input.userId,
    { now: input.now ?? Date.now(), ttlMs: INSTALLED_ON_TTL_MS },
    () => fetchInstalledOn(deps, input.login),
  );
}

// The repositories are listed with the user's own token, never the installation's: an installation
// token also names private repositories in an organisation that this user cannot see.
async function fetchInstalledOn(
  deps: InstalledOnDeps,
  login: string | undefined,
): Promise<InstalledOn> {
  const token = await deps.token();
  const [installations, slug] = await Promise.all([
    deps.github.listUserInstallations(token),
    deps.github.appSlug(),
  ]);
  const personalFirst = installations.toSorted(
    (a, b) =>
      Number(b.accountType === "User") - Number(a.accountType === "User") ||
      a.accountLogin.localeCompare(b.accountLogin),
  );
  const accounts = await Promise.all(
    personalFirst.map(async (entry): Promise<InstalledAccount> => {
      const account = {
        id: entry.id,
        login: entry.accountLogin,
        ...(entry.accountType === "User" && entry.accountLogin === login
          ? { manageUrl: `https://github.com/settings/installations/${entry.id}` }
          : {}),
      };
      if (entry.suspended) return { ...account, state: "suspended", repositories: [], more: 0 };
      if (entry.repositorySelection === "all")
        return { ...account, state: "all", repositories: [], more: 0 };
      const page = await deps.github.listUserInstallationRepositories(
        token,
        entry.id,
        NAMED_REPOSITORIES,
      );
      return {
        ...account,
        state: "selected",
        repositories: page.repositories.map((repository) => repository.name),
        more: Math.max(page.total - page.repositories.length, 0),
      };
    }),
  );
  return { accounts, installUrl: `https://github.com/apps/${slug}/installations/new` };
}
