import { createHash } from "node:crypto";

export function findingId(path: string | undefined, claim: string): string {
  const normalized = claim
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:;,]+$/, "");
  return createHash("sha256")
    .update(`${path ?? ""}\n${normalized}`)
    .digest("hex")
    .slice(0, 12);
}
