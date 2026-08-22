import { describe, expect, it, vi } from "vitest";
import { loadContractOverride } from "./cli.js";

const missing = async (path: string) => {
  throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
};

describe("loadContractOverride", () => {
  it("reads the default path when the file exists", async () => {
    await expect(
      loadContractOverride({
        env: {},
        defaultPath: "/home/u/.config/hawkeye/contract.md",
        readFile: async () => "DEFAULT RULES",
      }),
    ).resolves.toEqual({ path: "/home/u/.config/hawkeye/contract.md", content: "DEFAULT RULES" });
  });
  it("returns nothing when the default file does not exist", async () => {
    await expect(
      loadContractOverride({ env: {}, defaultPath: "/none.md", readFile: missing }),
    ).resolves.toBeUndefined();
  });
  it("prefers the env var over the default path", async () => {
    const readFile = vi.fn(async () => "ENV RULES");
    const override = await loadContractOverride({
      env: { HAWKEYE_CONTRACT_PATH: "/env.md" },
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
      defaultPath: "/none.md",
      readFile: async (path) => `rules from ${path}`,
    });
    expect(override).toEqual({ path: "/flag.md", content: "rules from /flag.md" });
  });
  it("fails fast when a requested contract cannot be read", async () => {
    await expect(
      loadContractOverride({
        env: { HAWKEYE_CONTRACT_PATH: "/env.md" },
        defaultPath: "/none.md",
        readFile: missing,
      }),
    ).rejects.toThrow("cannot read contract at /env.md");
    await expect(
      loadContractOverride({
        explicitPath: "/flag.md",
        env: {},
        defaultPath: "/none.md",
        readFile: missing,
      }),
    ).rejects.toThrow("cannot read contract at /flag.md");
  });
  it("fails fast when the default path is unreadable for another reason", async () => {
    await expect(
      loadContractOverride({
        env: {},
        defaultPath: "/denied.md",
        readFile: async () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ).rejects.toThrow("cannot read contract at /denied.md");
  });
});
