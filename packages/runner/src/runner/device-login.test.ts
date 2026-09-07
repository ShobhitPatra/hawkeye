import { describe, expect, it, vi } from "vitest";
import { deviceLogin } from "./device-login.js";

const started = {
  code: "AAAA-BBBB",
  deviceSecret: "hkd_secret",
  verifyUrl: "https://hawkeye.example/connect?code=AAAA-BBBB",
  expiresAt: "2026-01-01T12:10:00.000Z",
  intervalSeconds: 5,
};
const slept: number[] = [];

function login(responses: (Response | Error)[]) {
  slept.length = 0;
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  const logged: string[] = [];
  const promise = deviceLogin({
    baseUrl: "https://hawkeye.example/",
    runnerName: "laptop",
    fetch: fetch as unknown as typeof globalThis.fetch,
    log: (line) => logged.push(line),
    emphasize: (text) => `<${text}>`,
    now: () => Date.parse("2026-01-01T12:00:00.000Z"),
    sleep: async (milliseconds) => {
      slept.push(milliseconds);
    },
  });
  return { fetch, logged, promise };
}

describe("deviceLogin", () => {
  it("prints the code and link, polls with the secret, and returns the token", async () => {
    const { fetch, logged, promise } = login([
      Response.json(started, { status: 201 }),
      Response.json({ status: "pending" }),
      Response.json({ status: "approved", token: "hk_new" }),
    ]);
    await expect(promise).resolves.toBe("hk_new");
    expect(slept).toEqual([5000, 5000]);
    expect(logged).toEqual([
      "Code <AAAA-BBBB>",
      "Approve it at " + started.verifyUrl,
      "Waiting for approval, up to 10 minutes.",
    ]);
    const [startUrl, startInit] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(startUrl).toBe("https://hawkeye.example/api/runner/login");
    expect(JSON.parse(startInit.body as string)).toEqual({ name: "laptop" });
    const [collectUrl, collectInit] = fetch.mock.calls[1]! as unknown as [string, RequestInit];
    expect(collectUrl).toBe("https://hawkeye.example/api/runner/login/collect");
    expect(JSON.parse(collectInit.body as string)).toEqual({ deviceSecret: "hkd_secret" });
  });
  it("throws when the login expires on the server", async () => {
    const { promise } = login([
      Response.json(started, { status: 201 }),
      Response.json({ status: "expired" }, { status: 410 }),
    ]);
    await expect(promise).rejects.toThrow("the login expired before it was approved");
  });
  it("retries transient poll failures and gives up after three in a row", async () => {
    const { promise } = login([
      Response.json(started, { status: 201 }),
      Response.json({}, { status: 502 }),
      new Error("socket hang up"),
      Response.json({ status: "approved", token: "hk_new" }),
    ]);
    await expect(promise).resolves.toBe("hk_new");
    const failing = login([
      Response.json(started, { status: 201 }),
      Response.json({}, { status: 502 }),
      new Error("socket hang up"),
      Response.json({}, { status: 503 }),
    ]);
    await expect(failing.promise).rejects.toThrow(
      "the control plane failed the login 3 times in a row",
    );
  });
  it("rejects a refused or malformed start", async () => {
    await expect(
      login([Response.json({ error: "a runner needs a name" }, { status: 400 })]).promise,
    ).rejects.toThrow(
      'the control plane refused the login: 400 a runner needs a name (the runner name was "laptop"; pass --name to change it)',
    );
    await expect(
      login([Response.json({ ...started, deviceSecret: "" }, { status: 201 })]).promise,
    ).rejects.toThrow("invalid login response: deviceSecret");
    await expect(
      login([Response.json({ ...started, intervalSeconds: 0 }, { status: 201 })]).promise,
    ).rejects.toThrow("invalid login response: intervalSeconds");
    await expect(
      login([Response.json({ ...started, intervalSeconds: 86_400 }, { status: 201 })]).promise,
    ).rejects.toThrow("invalid login response: intervalSeconds");
  });
  it("rejects an approved response without a token", async () => {
    const { promise } = login([
      Response.json(started, { status: 201 }),
      Response.json({ status: "approved" }),
    ]);
    await expect(promise).rejects.toThrow("invalid login response: token");
  });
});
