import { DEFAULT_QUIET_WINDOW_SECONDS } from "./db/schema";

export function quietWindowSeconds(
  settings: { quietWindowSeconds: number } | undefined,
  armedPullRequest: { quietWindowSeconds: number | null },
): number {
  if (armedPullRequest.quietWindowSeconds !== null) return armedPullRequest.quietWindowSeconds;
  return settings?.quietWindowSeconds ?? DEFAULT_QUIET_WINDOW_SECONDS;
}
