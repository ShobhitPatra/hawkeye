const MAX_POLL_FAILURES = 3;
const MAX_POLL_INTERVAL_SECONDS = 60;

export type DeviceLoginInput = {
  baseUrl: string;
  runnerName: string;
  fetch: typeof fetch;
  log(line: string): void;
  emphasize?(text: string): string;
  now?(): number;
  sleep?(milliseconds: number): Promise<void>;
};

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "")
    throw new Error(`invalid login response: ${field}`);
  return value;
}

function seconds(value: unknown, field: string): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_POLL_INTERVAL_SECONDS
  )
    throw new Error(`invalid login response: ${field}`);
  return value as number;
}

export async function deviceLogin(input: DeviceLoginInput): Promise<string> {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const sleep = input.sleep ?? sleepFor;

  const started = await input.fetch(`${baseUrl}/api/runner/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.runnerName }),
  });
  const payload = (await started.json().catch(() => ({}))) as Record<string, unknown>;
  if (started.status !== 201)
    throw new Error(
      `the control plane refused the login: ${started.status}${typeof payload.error === "string" ? ` ${payload.error}` : ""}${started.status === 400 ? ` (the runner name was "${input.runnerName}"; pass --name to change it)` : ""}`,
    );
  const code = text(payload.code, "code");
  const deviceSecret = text(payload.deviceSecret, "deviceSecret");
  const verifyUrl = text(payload.verifyUrl, "verifyUrl");
  const intervalSeconds = seconds(payload.intervalSeconds, "intervalSeconds");

  const expiresAt = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : NaN;
  const minutes = Number.isNaN(expiresAt)
    ? undefined
    : Math.round((expiresAt - (input.now ?? Date.now)()) / 60_000);
  input.log(`Code ${(input.emphasize ?? ((value) => value))(code)}`);
  input.log(`Approve it at ${verifyUrl}`);
  input.log(
    `Waiting for approval${minutes === undefined || minutes < 1 ? "" : `, up to ${minutes} minute${minutes === 1 ? "" : "s"}`}.`,
  );

  let failures = 0;
  for (;;) {
    await sleep(intervalSeconds * 1000);
    const collected = await input
      .fetch(`${baseUrl}/api/runner/login/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSecret }),
      })
      .catch(() => undefined);
    if (collected === undefined || (collected.status !== 200 && collected.status !== 410)) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES)
        throw new Error(
          `the control plane failed the login ${MAX_POLL_FAILURES} times in a row; run login again`,
        );
      continue;
    }
    failures = 0;
    if (collected.status === 410)
      throw new Error("the login expired before it was approved; run login again");
    const state = (await collected.json().catch(() => ({}))) as Record<string, unknown>;
    if (state.status === "pending") continue;
    if (state.status === "approved") return text(state.token, "token");
    throw new Error(`invalid login response: status ${String(state.status)}`);
  }
}
