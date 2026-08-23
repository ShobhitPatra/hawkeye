import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    secret: env.betterAuthSecret(),
    baseURL: env.betterAuthUrl(),
    user: { additionalFields: { githubLogin: { type: "string", required: false, input: false } } },
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
