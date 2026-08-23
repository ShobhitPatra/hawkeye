import { env } from "../env";

export function getAppCredentials(): { appId: string; privateKeyPem: string } {
  return {
    appId: env.githubAppId(),
    privateKeyPem: env.githubAppPrivateKey().replaceAll("\\n", "\n"),
  };
}
