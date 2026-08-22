import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createDb } from "./db/client.js";
import * as schema from "./db/schema.js";
import { env } from "./env.js";

export const auth = betterAuth({
  database: drizzleAdapter(createDb(env.databaseUrl()), { provider: "pg", schema }),
  secret: env.betterAuthSecret(),
  baseURL: env.betterAuthUrl(),
  socialProviders: {
    github: { clientId: env.githubClientId(), clientSecret: env.githubClientSecret() },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
