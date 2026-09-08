import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import type { Theme } from "@/theme";
import { Mark } from "./mark";
import { SignInButton } from "./sign-in-button";
import { ThemeChoice } from "./theme-choice";
import { ThemeIcon } from "./theme-icon";

export function SiteHeader({ theme, callbackURL }: { theme: Theme; callbackURL?: string }) {
  return (
    <header className="hk-topbar">
      <a className="hk-wordmark hk-lockup" href="/">
        <Mark />
        hawkeye
      </a>
      <div className="hk-topbar-end">
        <a href={HAWKEYE_REPOSITORY_URL}>Source</a>
        <details className="hk-menu" data-icon>
          <summary aria-label="Theme" title="Theme">
            <ThemeIcon />
          </summary>
          <div className="hk-menu-panel">
            <ThemeChoice theme={theme} />
          </div>
        </details>
        <SignInButton {...(callbackURL ? { callbackURL } : {})} />
      </div>
    </header>
  );
}
