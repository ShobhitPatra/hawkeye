import { headers } from "next/headers";
import { getAuth } from "@/auth";
import { getDb } from "@/db";
import { createGitHubAppClient } from "@/github/app";
import { userGitHubToken } from "@/installation-sync";
import { readInstalledOn } from "@/installed-on";
import { InstalledOnFailed, InstalledOnView } from "./installed-on-view";

export async function InstalledOn({
  userId,
  login,
}: {
  userId: string;
  login: string | undefined;
}) {
  const requestHeaders = await headers();
  try {
    const installed = await readInstalledOn(
      {
        github: createGitHubAppClient({ fetch }),
        token: () => userGitHubToken({ auth: getAuth(), db: getDb() }, userId, requestHeaders),
      },
      { userId, login },
    );
    return <InstalledOnView installed={installed} />;
  } catch (error) {
    console.error(
      `installations not read for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return <InstalledOnFailed />;
  }
}
