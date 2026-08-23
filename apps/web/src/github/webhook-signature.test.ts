import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./webhook-signature";

const secret = "test-secret";
const body = JSON.stringify({ action: "created" });

function sign(payload: string, key: string): string {
  return `sha256=${createHmac("sha256", key).update(payload).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("returns true for a matching signature", () => {
    const signatureHeader = sign(body, secret);
    expect(verifyWebhookSignature({ secret, body, signatureHeader })).toBe(true);
  });

  it("returns false for a signature computed with a different secret", () => {
    const signatureHeader = sign(body, "wrong-secret");
    expect(verifyWebhookSignature({ secret, body, signatureHeader })).toBe(false);
  });

  it("returns false for a signature computed over a different body", () => {
    const signatureHeader = sign("different body", secret);
    expect(verifyWebhookSignature({ secret, body, signatureHeader })).toBe(false);
  });

  it("returns false when the header is missing", () => {
    expect(verifyWebhookSignature({ secret, body, signatureHeader: undefined })).toBe(false);
  });

  it("returns false when the header has no sha256= prefix", () => {
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature({ secret, body, signatureHeader: digest })).toBe(false);
  });

  it("returns false when the header is shorter than the expected digest", () => {
    expect(verifyWebhookSignature({ secret, body, signatureHeader: "sha256=abc" })).toBe(false);
  });
});
