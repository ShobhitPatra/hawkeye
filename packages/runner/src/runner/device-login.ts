export const MAX_POLL_FAILURES = 3;

export type DeviceLoginInput = {
  baseUrl: string;
  runnerName: string;
  fetch: typeof fetch;
  log(line: string): void;
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
      `the control plane refused the login: ${started.status}${typeof payload.error === "string" ? ` ${payload.error}` : ""}`,
    );
  const code = text(payload.code, "code");
  const deviceSecret = text(payload.deviceSecret, "deviceSecret");
  const verifyUrl = text(payload.verifyUrl, "verifyUrl");
  const intervalSeconds = payload.intervalSeconds;
  if (!Number.isInteger(intervalSeconds) || (intervalSeconds as number) < 1)
    throw new Error("invalid login response: intervalSeconds");

  input.log(`code ${code}`);
  input.log(`approve at ${verifyUrl}`);

  let failures = 0;
  for (;;) {
    await sleep((intervalSeconds as number) * 1000);
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
