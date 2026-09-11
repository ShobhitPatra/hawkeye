import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import { syncInstallationsForUser } from "./installation-sync";

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
            await syncInstallationsForUser(session.userId).catch((error: unknown) => {
              console.error(
                `installations not synced for user ${session.userId}: ${error instanceof Error ? error.message : String(error)}`,
              );
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
