import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAppJwt } from "./app-auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

describe("createAppJwt", () => {
  it("produces a verifiable RS256 token with app claims", () => {
    const now = new Date("2026-08-22T10:00:00Z");
    const token = createAppJwt({ appId: "4680538", privateKeyPem: pem, now });
    const [header, payload, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ iat: 1787392740, exp: 1787393340, iss: "4680538" });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
  it("rejects an empty app id", () => {
    expect(() => createAppJwt({ appId: "", privateKeyPem: pem })).toThrow(/appId/);
  });
});
