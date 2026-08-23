import Link from "next/link";
import { getSession } from "@/session";
import { SignInButton } from "./sign-in-button";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const session = await getSession();
  return (
    <main>
      <h1>Hawkeye</h1>
      <p>Personal code reviewer on your own plan.</p>
      {session ? (
        <>
          <Link href="/prs">Pull requests</Link>
          <Link href="/runners">Runners</Link>
          <SignOutButton />
        </>
      ) : (
        <SignInButton />
      )}
    </main>
  );
}
