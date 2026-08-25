import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export async function getSession() {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}

export async function requireSession(returnTo?: string) {
  const session = await getSession();
  if (!session) redirect(returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : "/");
  return session;
}
