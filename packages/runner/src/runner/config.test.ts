import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRunnerConfig, writeRunnerConfig } from "./config.js";

const file = JSON.stringify({ controlPlaneUrl: "https://hawkeye.example", token: "hk_1" });
const missing = async () => {
  throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};

describe("loadRunnerConfig", () => {
  it("reads the file", async () => {
    await expect(
      loadRunnerConfig({ env: {}, configPath: "/c.json", readFile: async () => file }),
    ).resolves.toEqual({ controlPlaneUrl: "https://hawkeye.example", token: "hk_1" });
  });
  it("lets env override file fields", async () => {
    const c = await loadRunnerConfig({
      env: { HAWKEYE_RUNNER_TOKEN: "hk_env" },
      configPath: "/c.json",
      readFile: async () => file,
    });
    expect(c).toEqual({ controlPlaneUrl: "https://hawkeye.example", token: "hk_env" });
  });
  it("works from env alone when the file is missing", async () => {
    const c = await loadRunnerConfig({
      env: { HAWKEYE_CONTROL_PLANE_URL: "http://localhost:3000", HAWKEYE_RUNNER_TOKEN: "hk_2" },
      configPath: "/none",
      readFile: missing,
    });
    expect(c).toEqual({ controlPlaneUrl: "http://localhost:3000", token: "hk_2" });
  });
  it("names the missing field and the login command", async () => {
    await expect(
      loadRunnerConfig({ env: {}, configPath: "/none", readFile: missing }),
    ).rejects.toThrow(
      /Not connected\. Run npx hawkeye-review runner login --url <control plane url> first, or set HAWKEYE_CONTROL_PLANE_URL\./,
    );
    await expect(
      loadRunnerConfig({
        env: {},
        configPath: "/c.json",
        readFile: async () => JSON.stringify({ controlPlaneUrl: "https://x", token: "" }),
      }),
    ).rejects.toThrow(/Not connected\..*HAWKEYE_RUNNER_TOKEN\./);
  });
  it("rejects non-string values in the config file", async () => {
    await expect(
      loadRunnerConfig({
        env: {},
        configPath: "/c.json",
        readFile: async () => JSON.stringify({ controlPlaneUrl: 3000, token: "hk_1" }),
      }),
    ).rejects.toThrow("Invalid controlPlaneUrl in /c.json: expected a string");
    await expect(
      loadRunnerConfig({
        env: {},
        configPath: "/c.json",
        readFile: async () => JSON.stringify({ controlPlaneUrl: "https://x", token: { a: 1 } }),
      }),
    ).rejects.toThrow("Invalid token in /c.json: expected a string");
  });
  it("ignores empty env vars instead of shadowing the file", async () => {
    await expect(
      loadRunnerConfig({
        env: { HAWKEYE_CONTROL_PLANE_URL: "", HAWKEYE_RUNNER_TOKEN: "" },
        configPath: "/c.json",
        readFile: async () => file,
      }),
    ).resolves.toEqual({ controlPlaneUrl: "https://hawkeye.example", token: "hk_1" });
  });
  it("surfaces unreadable config files", async () => {
    await expect(
      loadRunnerConfig({
        env: {},
        configPath: "/c.json",
        readFile: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ).rejects.toThrow("Cannot read runner config /c.json: EACCES");
  });
});

describe("writeRunnerConfig", () => {
  it("writes the config readable only by the owner and loads it back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hawkeye-runner-config-"));
    const configPath = join(directory, "nested", "runner.json");
    await writeRunnerConfig(configPath, {
      controlPlaneUrl: "https://hawkeye.example",
      token: "hk_1",
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    await expect(
      loadRunnerConfig({ env: {}, configPath, readFile: (p) => readFile(p, "utf8") }),
    ).resolves.toEqual({ controlPlaneUrl: "https://hawkeye.example", token: "hk_1" });
  });
  it("rejects a url that is not http(s) and an empty token", async () => {
    await expect(
      writeRunnerConfig("/x", { controlPlaneUrl: "hawkeye", token: "hk" }),
    ).rejects.toThrow('--url must be an http(s) URL, got "hawkeye"');
    await expect(
      writeRunnerConfig("/x", { controlPlaneUrl: "https://h", token: "" }),
    ).rejects.toThrow("--token must not be empty");
  });
});
