import { describe, expect, it, vi } from "vitest";
import { deviceLogin } from "./device-login.js";

const started = {
  code: "AAAA-BBBB",
  deviceSecret: "hkd_secret",
  verifyUrl: "https://hawkeye.example/connect?code=AAAA-BBBB",
  expiresAt: "2026-01-01T12:10:00.000Z",
  intervalSeconds: 5,
};

function login(responses: Response[], overrides: { now?: () => Date } = {}) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    return next;
  });
  const logged: string[] = [];
  const promise = deviceLogin({
    baseUrl: "https://hawkeye.example/",
    runnerName: "laptop",
    fetch: fetch as unknown as typeof globalThis.fetch,
    log: (line) => logged.push(line),
    sleep: async () => {},
    now: overrides.now ?? (() => new Date("2026-01-01T12:00:00.000Z")),
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
    expect(logged).toEqual(["code AAAA-BBBB", "approve at " + started.verifyUrl]);
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
  it("throws when the deadline passes without approval", async () => {
    const clock = { value: new Date("2026-01-01T12:00:00.000Z") };
    const { promise } = login(
      [
        Response.json(started, { status: 201 }),
        Response.json({ status: "pending" }),
        Response.json({ status: "pending" }),
      ],
      {
        now: () => {
          clock.value = new Date(clock.value.getTime() + 6 * 60_000);
          return clock.value;
        },
      },
    );
    await expect(promise).rejects.toThrow("the login expired before it was approved");
  });
  it("rejects a refused or malformed start", async () => {
    await expect(
      login([Response.json({ error: "a runner needs a name" }, { status: 400 })]).promise,
    ).rejects.toThrow("the control plane refused the login: 400 a runner needs a name");
    await expect(
      login([Response.json({ ...started, deviceSecret: "" }, { status: 201 })]).promise,
    ).rejects.toThrow("invalid login response: deviceSecret");
  });
  it("rejects an approved response without a token", async () => {
    const { promise } = login([
      Response.json(started, { status: 201 }),
      Response.json({ status: "approved" }),
    ]);
    await expect(promise).rejects.toThrow("invalid login response: token");
  });
});
