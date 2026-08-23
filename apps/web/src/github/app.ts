import { createGitHubClient, type GitHubClient } from "@hawkeye/core";
import { getAppCredentials } from "./app-credentials";

export function createGitHubAppClient(deps: { fetch: typeof fetch }): GitHubClient {
  const { appId, privateKeyPem } = getAppCredentials();
  return createGitHubClient({ appId, privateKeyPem, fetch: deps.fetch });
}
