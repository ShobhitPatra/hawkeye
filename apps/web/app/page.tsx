import Link from "next/link";
import { localPath } from "@/local-path";
import { getSession } from "@/session";
import { SignInButton } from "./sign-in-button";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const session = await getSession();
  const returnTo = localPath((await searchParams).returnTo);
  return (
    <main>
      <h1>Hawkeye</h1>
      <p>Personal code reviewer on your own plan.</p>
      {session ? (
        <>
          <Link className="hk-link" href="/prs">
            Pull requests
          </Link>
          <Link className="hk-link" href="/runners">
            Runners
          </Link>
          <Link className="hk-link" href="/connect">
            Connect a runner
          </Link>
          <SignOutButton />
        </>
      ) : (
        <SignInButton {...(returnTo ? { callbackURL: returnTo } : {})} />
      )}
    </main>
  );
}
