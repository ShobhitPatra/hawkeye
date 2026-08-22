import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createDb } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(createDb(env.databaseUrl()), { provider: "pg", schema }),
    secret: env.betterAuthSecret(),
    baseURL: env.betterAuthUrl(),
    socialProviders: {
      github: { clientId: env.githubClientId(), clientSecret: env.githubClientSecret() },
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
