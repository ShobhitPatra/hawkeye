import { describe, expect, it, vi } from "vitest";
import { createProgram, loadContractOverride } from "./cli.js";

const missing = async (path: string) => {
  throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
};

describe("loadContractOverride", () => {
  it("reads the default path when the file exists", async () => {
    await expect(
      loadContractOverride({
        env: {},
        home: "/h",
        defaultPath: "/home/u/.config/hawkeye/contract.md",
        readFile: async () => "DEFAULT RULES",
      }),
    ).resolves.toEqual({ path: "/home/u/.config/hawkeye/contract.md", content: "DEFAULT RULES" });
  });
  it("returns nothing when the default file does not exist", async () => {
    await expect(
      loadContractOverride({ env: {}, home: "/h", defaultPath: "/none.md", readFile: missing }),
    ).resolves.toBeUndefined();
  });
  it("prefers the env var over the default path", async () => {
    const readFile = vi.fn(async () => "ENV RULES");
    const override = await loadContractOverride({
      env: { HAWKEYE_CONTRACT_PATH: "/env.md" },
      home: "/h",
      defaultPath: "/none.md",
      readFile,
    });
    expect(override).toEqual({ path: "/env.md", content: "ENV RULES" });
    expect(readFile).toHaveBeenCalledWith("/env.md");
  });
  it("prefers an explicit path over the env var", async () => {
    const override = await loadContractOverride({
      explicitPath: "/flag.md",
      env: { HAWKEYE_CONTRACT_PATH: "/env.md" },
      home: "/h",
      defaultPath: "/none.md",
      readFile: async (path) => `rules from ${path}`,
    });
    expect(override).toEqual({ path: "/flag.md", content: "rules from /flag.md" });
  });
  it("expands a leading ~/ in an explicit contract path", async () => {
    const readFile = vi.fn(async (path: string) => `rules from ${path}`);
    const override = await loadContractOverride({
      explicitPath: "~/c.md",
      env: {},
      home: "/h",
      defaultPath: "/none.md",
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith("/h/c.md");
    expect(override).toEqual({ path: "/h/c.md", content: "rules from /h/c.md" });
  });
  it("expands a leading ~/ in the env contract path", async () => {
    const readFile = vi.fn(async (path: string) => `rules from ${path}`);
    const override = await loadContractOverride({
      env: { HAWKEYE_CONTRACT_PATH: "~/env.md" },
      home: "/h",
      defaultPath: "/none.md",
      readFile,
    });
    expect(readFile).toHaveBeenCalledWith("/h/env.md");
    expect(override?.path).toBe("/h/env.md");
  });
  it("fails fast when a requested contract cannot be read", async () => {
    await expect(
      loadContractOverride({
        env: { HAWKEYE_CONTRACT_PATH: "/env.md" },
        home: "/h",
        defaultPath: "/none.md",
        readFile: missing,
      }),
    ).rejects.toThrow("cannot read contract at /env.md");
    await expect(
      loadContractOverride({
        explicitPath: "/flag.md",
        env: {},
        home: "/h",
        defaultPath: "/none.md",
        readFile: missing,
      }),
    ).rejects.toThrow("cannot read contract at /flag.md");
  });
  it("fails fast when the default path is unreadable for another reason", async () => {
    await expect(
      loadContractOverride({
        env: {},
        home: "/h",
        defaultPath: "/denied.md",
        readFile: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ).rejects.toThrow("cannot read contract at /denied.md");
  });
});

describe("review", () => {
  it("rejects --full without --dry-run before touching anything", async () => {
    const stderr = vi.fn();
    const exitCode = process.exitCode;
    await createProgram({ stdout: vi.fn(), stderr }).parseAsync([
      "node",
      "hawkeye",
      "review",
      "octo/repo#1",
      "--full",
    ]);
    expect(stderr).toHaveBeenCalledWith(
      "--full applies only with --dry-run; a posted review is read on GitHub",
    );
    expect(process.exitCode).toBe(1);
    process.exitCode = exitCode;
  });
});
