import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppClient } from "./app";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("createGitHubAppClient", () => {
  it("signs app requests with the configured credentials", async () => {
    process.env.GITHUB_APP_ID = "4680538";
    process.env.GITHUB_APP_PRIVATE_KEY = pem.replaceAll("\n", "\\n");
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(JSON.stringify({ token: "ghs_x" }), { status: 201 });
    }) as unknown as typeof fetch;

    const client = createGitHubAppClient({ fetch: fetchImpl });
    await expect(client.installationTokenById("155822984")).resolves.toBe("ghs_x");

    const authorization = (calls[0]!.headers as Record<string, string>).Authorization!;
    const claims = JSON.parse(
      Buffer.from(authorization.split(".")[1]!, "base64url").toString("utf8"),
    ) as { iss: string };
    expect(claims.iss).toBe("4680538");
  });

  it("throws when the app credentials are missing", () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(() => createGitHubAppClient({ fetch })).toThrow("GITHUB_APP_ID is required");
  });
});
