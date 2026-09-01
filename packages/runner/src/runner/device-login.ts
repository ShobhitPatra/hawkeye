export type DeviceLoginInput = {
  baseUrl: string;
  runnerName: string;
  fetch: typeof fetch;
  log(line: string): void;
  sleep?(milliseconds: number): Promise<void>;
  now?(): Date;
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
  const now = input.now ?? (() => new Date());

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
  const expiresAt = new Date(text(payload.expiresAt, "expiresAt"));
  if (Number.isNaN(expiresAt.getTime())) throw new Error("invalid login response: expiresAt");
  const intervalSeconds = payload.intervalSeconds;
  if (!Number.isInteger(intervalSeconds) || (intervalSeconds as number) < 1)
    throw new Error("invalid login response: intervalSeconds");

  input.log(`code ${code}`);
  input.log(`approve at ${verifyUrl}`);

  for (;;) {
    if (now().getTime() >= expiresAt.getTime())
      throw new Error("the login expired before it was approved; run login again");
    await sleep((intervalSeconds as number) * 1000);
    const collected = await input.fetch(`${baseUrl}/api/runner/login/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceSecret }),
    });
    const state = (await collected.json().catch(() => ({}))) as Record<string, unknown>;
    if (collected.status === 410)
      throw new Error("the login expired before it was approved; run login again");
    if (collected.status !== 200)
      throw new Error(`the control plane failed the login: ${collected.status}`);
    if (state.status === "pending") continue;
    if (state.status === "approved") return text(state.token, "token");
    throw new Error(`invalid login response: status ${String(state.status)}`);
  }
}
