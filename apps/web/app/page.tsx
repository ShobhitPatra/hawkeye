import { redirect } from "next/navigation";
import { localPath } from "@/local-path";
import { getSession } from "@/session";
import { SignInButton } from "./sign-in-button";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getSession();
  const returnTo = localPath((await searchParams).returnTo);
  if (session) redirect(returnTo && returnTo !== "/" ? returnTo : "/prs");
  return (
    <main>
      <h1>Hawkeye</h1>
      <p>Personal code reviewer on your own plan.</p>
      <SignInButton {...(returnTo ? { callbackURL: returnTo } : {})} />
    </main>
  );
}
