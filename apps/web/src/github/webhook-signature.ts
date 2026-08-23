import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature({
  secret,
  body,
  signatureHeader,
}: {
  secret: string;
  body: string;
  signatureHeader: string | undefined | null;
}): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("hex"), "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
