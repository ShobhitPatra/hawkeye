import type { Db } from "./db/client";
import { normalizeRunnerName } from "./runner-tokens";
import {
  collectRunnerLogin,
  formatRunnerLoginCode,
  startRunnerLogin,
  TooManyRunnerLoginsError,
} from "./runner-login";

export const RUNNER_LOGIN_POLL_INTERVAL_SECONDS = 5;

export type CollectLoginDeps = { db: Db; now?: () => Date };
export type RunnerLoginApiDeps = CollectLoginDeps & { siteUrl: string };

function parseRunnerName(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw new Error("a login must be an object");
  const { name } = payload as Record<string, unknown>;
  if (typeof name !== "string") throw new Error("a runner needs a name");
  return normalizeRunnerName(name);
}

export async function startLogin(request: Request, deps: RunnerLoginApiDeps): Promise<Response> {
  let runnerName: string;
  try {
    runnerName = parseRunnerName(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid login" },
      { status: 400 },
    );
  }
  const now = deps.now?.() ?? new Date();
  let started: Awaited<ReturnType<typeof startRunnerLogin>>;
  try {
    started = await startRunnerLogin(deps.db, { runnerName, now });
  } catch (error) {
    if (error instanceof TooManyRunnerLoginsError)
      return Response.json({ error: error.message }, { status: 429 });
    throw error;
  }
  const { code, deviceSecret, expiresAt } = started;
  const verifyUrl = `${deps.siteUrl}/connect?code=${formatRunnerLoginCode(code)}`;
  return Response.json(
    {
      code: formatRunnerLoginCode(code),
      deviceSecret,
      verifyUrl,
      expiresAt: expiresAt.toISOString(),
      intervalSeconds: RUNNER_LOGIN_POLL_INTERVAL_SECONDS,
    },
    { status: 201 },
  );
}

function parseDeviceSecret(payload: unknown): string {
  if (typeof payload !== "object" || payload === null)
    throw new Error("a collect request must be an object");
  const { deviceSecret } = payload as Record<string, unknown>;
  if (typeof deviceSecret !== "string" || !deviceSecret)
    throw new Error("a collect request needs a device secret");
  return deviceSecret;
}

export async function collectLogin(request: Request, deps: CollectLoginDeps): Promise<Response> {
  let deviceSecret: string;
  try {
    deviceSecret = parseDeviceSecret(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid collect request" },
      { status: 400 },
    );
  }
  const now = deps.now?.() ?? new Date();
  const result = await collectRunnerLogin(deps.db, { deviceSecret, now });
  return Response.json(result, { status: result.status === "expired" ? 410 : 200 });
}
