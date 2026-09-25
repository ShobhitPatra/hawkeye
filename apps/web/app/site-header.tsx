import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { Wordmark } from "./wordmark";
import { SignInButton } from "./sign-in-button";

export function SiteHeader({ callbackURL, signedIn }: { callbackURL?: string; signedIn: boolean }) {
  return (
    <header className="hk-topbar">
      <Wordmark href="/" />
      <div className="hk-topbar-end">
        <a href={HAWKEYE_REPOSITORY_URL}>Source</a>
        {signedIn ? (
          <a className="hk-button" href="/overview">
            Dashboard
          </a>
        ) : (
          <SignInButton {...(callbackURL ? { callbackURL } : {})} />
        )}
      </div>
    </header>
  );
}
