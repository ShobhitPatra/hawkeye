import { describe, expect, it, vi } from "vitest";
import { NO_GITHUB_TOKEN, resolveGitHubToken } from "./token.js";

const ghSaysToken = vi.fn(async () => ({ exitCode: 0, stdout: "gho_cli\n" }));

describe("resolveGitHubToken", () => {
  it("prefers the option over the environment and gh", async () => {
    const exec = vi.fn(ghSaysToken);
    await expect(
      resolveGitHubToken({ option: "opt", env: { GITHUB_TOKEN: "env" }, exec }),
    ).resolves.toBe("opt");
    expect(exec).not.toHaveBeenCalled();
  });
  it("prefers the environment over gh", async () => {
    const exec = vi.fn(ghSaysToken);
    await expect(resolveGitHubToken({ env: { GITHUB_TOKEN: "env" }, exec })).resolves.toBe("env");
    expect(exec).not.toHaveBeenCalled();
  });
  it("falls back to gh auth token and trims its output", async () => {
    const exec = vi.fn(ghSaysToken);
    await expect(resolveGitHubToken({ env: {}, exec })).resolves.toBe("gho_cli");
    expect(exec).toHaveBeenCalledWith("gh", ["auth", "token"]);
  });
  it("fails when gh exits non-zero, prints nothing, or is missing", async () => {
    await expect(
      resolveGitHubToken({ env: {}, exec: async () => ({ exitCode: 1, stdout: "" }) }),
    ).rejects.toThrow(NO_GITHUB_TOKEN);
    await expect(
      resolveGitHubToken({ env: {}, exec: async () => ({ exitCode: 0, stdout: " \n" }) }),
    ).rejects.toThrow(NO_GITHUB_TOKEN);
    await expect(
      resolveGitHubToken({
        env: { GITHUB_TOKEN: "" },
        exec: async () => {
          throw new Error("ENOENT");
        },
      }),
    ).rejects.toThrow(NO_GITHUB_TOKEN);
  });
});
