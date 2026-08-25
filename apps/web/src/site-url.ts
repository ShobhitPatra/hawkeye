import { env } from "./env";

export function siteUrl(): string {
  return env.betterAuthUrl().replace(/\/+$/, "");
}
