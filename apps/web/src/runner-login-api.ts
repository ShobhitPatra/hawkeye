import type { Db } from "./db/client";
import { collectRunnerLogin, formatRunnerLoginCode, startRunnerLogin } from "./runner-login";

export const RUNNER_LOGIN_POLL_INTERVAL_SECONDS = 5;

const RUNNER_NAME_MAX_LENGTH = 64;
const RUNNER_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

export type CollectLoginDeps = { db: Db; now?: () => Date };
export type RunnerLoginApiDeps = CollectLoginDeps & { siteUrl: string };

function parseRunnerName(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw new Error("a login must be an object");
  const { name } = payload as Record<string, unknown>;
  if (typeof name !== "string") throw new Error("a runner needs a name");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("a runner needs a name");
  if (trimmed.length > RUNNER_NAME_MAX_LENGTH)
    throw new Error(`a runner name is at most ${RUNNER_NAME_MAX_LENGTH} characters`);
  if (!RUNNER_NAME.test(trimmed))
    throw new Error("a runner name uses letters, digits, spaces, dots, underscores and dashes");
  return trimmed;
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
  const { code, deviceSecret, expiresAt } = await startRunnerLogin(deps.db, { runnerName, now });
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
