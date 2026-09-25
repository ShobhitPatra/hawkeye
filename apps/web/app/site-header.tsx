import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import type { Theme } from "@/theme";
import { Mark } from "./mark";
import { SignInButton } from "./sign-in-button";
import { Menu } from "./menu";
import { ThemeChoice } from "./theme-choice";
import { ThemeIcon } from "./theme-icon";

export function SiteHeader({
  theme,
  callbackURL,
  signedIn,
}: {
  theme: Theme;
  callbackURL?: string;
  signedIn: boolean;
}) {
  return (
    <header className="hk-topbar">
      <a className="hk-wordmark hk-lockup" href="/">
        <Mark />
        <span className="hk-wordmark-text">hawkeye</span>
      </a>
      <div className="hk-topbar-end">
        <a href={HAWKEYE_REPOSITORY_URL}>Source</a>
        <Menu
          icon
          summary={
            <summary aria-label="Theme" title="Theme">
              <ThemeIcon />
            </summary>
          }
        >
          <ThemeChoice theme={theme} />
        </Menu>
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
