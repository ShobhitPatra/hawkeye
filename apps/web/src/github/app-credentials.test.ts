import { afterEach, describe, expect, it } from "vitest";
import { getAppCredentials } from "./app-credentials";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("getAppCredentials", () => {
  it("normalizes escaped newlines in the private key", () => {
    process.env.GITHUB_APP_ID = "4680538";
    process.env.GITHUB_APP_PRIVATE_KEY =
      "-----BEGIN RSA PRIVATE KEY-----\\nkey\\n-----END RSA PRIVATE KEY-----";
    expect(getAppCredentials()).toEqual({
      appId: "4680538",
      privateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----",
    });
  });

  it("keeps a key that already has real newlines", () => {
    process.env.GITHUB_APP_ID = "1";
    process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nkey\n";
    expect(getAppCredentials().privateKeyPem).toBe("-----BEGIN RSA PRIVATE KEY-----\nkey\n");
  });

  it("throws when the credentials are missing", () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    expect(() => getAppCredentials()).toThrow("GITHUB_APP_ID is required");
  });
});
