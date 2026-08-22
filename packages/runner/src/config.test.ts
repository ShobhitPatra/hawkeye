import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const file = JSON.stringify({ appId: 1, appSlug: "hawkeye-review", privateKeyPath: "/k.pem" });
describe("loadConfig", () => {
  it("reads the file and coerces appId to string", async () => {
    await expect(
      loadConfig({ env: {}, home: "/h", configPath: "/c.json", readFile: async () => file }),
    ).resolves.toEqual({ appId: "1", appSlug: "hawkeye-review", privateKeyPath: "/k.pem" });
  });
  it("lets env override file fields", async () => {
    const c = await loadConfig({
      env: { HAWKEYE_APP_ID: "9" },
      home: "/h",
      configPath: "/c.json",
      readFile: async () => file,
    });
    expect(c.appId).toBe("9");
  });
  it("works from env alone when the file is missing", async () => {
    const c = await loadConfig({
      env: { HAWKEYE_APP_ID: "9", HAWKEYE_APP_SLUG: "s", HAWKEYE_APP_PRIVATE_KEY_PATH: "/p" },
      home: "/h",
      configPath: "/none",
      readFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(c).toEqual({ appId: "9", appSlug: "s", privateKeyPath: "/p" });
  });
  it("expands a leading ~/ in privateKeyPath", async () => {
    const c = await loadConfig({
      env: {},
      home: "/h",
      configPath: "/c.json",
      readFile: async () =>
        JSON.stringify({
          appId: 1,
          appSlug: "s",
          privateKeyPath: "~/.config/hawkeye/app.pem",
        }),
    });
    expect(c.privateKeyPath).toBe("/h/.config/hawkeye/app.pem");
  });
  it("leaves an absolute privateKeyPath unchanged", async () => {
    const c = await loadConfig({
      env: {},
      home: "/h",
      configPath: "/c.json",
      readFile: async () => file,
    });
    expect(c.privateKeyPath).toBe("/k.pem");
  });
  it("names the missing field", async () => {
    await expect(
      loadConfig({
        env: {},
        home: "/h",
        configPath: "/c.json",
        readFile: async () => JSON.stringify({ appId: 1 }),
      }),
    ).rejects.toThrow(/appSlug/);
  });
});
