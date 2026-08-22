import { sign } from "node:crypto";

const base64url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

export function createAppJwt(input: { appId: string; privateKeyPem: string; now?: Date }): string {
  if (input.appId.length === 0) throw new Error("appId is required");
  const seconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: input.appId }),
  );
  const signature = base64url(
    sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), input.privateKeyPem),
  );
  return `${header}.${payload}.${signature}`;
}
