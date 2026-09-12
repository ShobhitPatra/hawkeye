import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import { createGitHubAppClient } from "./github/app";
import { describeSyncFailure, syncInstallationsForUser } from "./installation-sync";
import { forgetUserListings } from "./pull-requests";

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secret: env.betterAuthSecret(),
    baseURL: env.betterAuthUrl(),
    user: { additionalFields: { githubLogin: { type: "string", required: false } } },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await syncInstallationsForUser(
              { auth: getAuth(), db: getDb(), github: createGitHubAppClient({ fetch }) },
              session.userId,
            )
              .then((synced) => {
                if (synced.linked > 0 || synced.unlinked > 0) forgetUserListings(session.userId);
              })
              .catch((error: unknown) => {
                console.error(describeSyncFailure(session.userId, error));
              });
          },
        },
      },
      user: {
        update: {
          before: async (user, context) => {
            if (context?.path === "/update-user" && "githubLogin" in user) {
              const { githubLogin: _ignored, ...rest } = user;
              return { data: rest };
            }
            return { data: user };
          },
        },
      },
    },
    socialProviders: {
      github: {
        clientId: env.githubClientId(),
        clientSecret: env.githubClientSecret(),
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({ githubLogin: profile.login }),
      },
    },
    account: { encryptOAuthTokens: true },
    plugins: [nextCookies()],
  });
}

const authCache = globalThis as typeof globalThis & { hawkeyeAuth?: ReturnType<typeof createAuth> };

export function getAuth() {
  authCache.hawkeyeAuth ??= createAuth();
  return authCache.hawkeyeAuth;
}
