import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

export const getSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export async function requireSession(returnTo?: string) {
  const session = await getSession();
  if (!session) redirect(returnTo ? `/?returnTo=${encodeURIComponent(returnTo)}` : "/");
  return session;
}
