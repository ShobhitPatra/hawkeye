import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { Mark } from "./mark";

export const SELF_HOSTING_URL = `${HAWKEYE_REPOSITORY_URL}/blob/main/docs/self-hosting.md`;
export const CONTRIBUTING_URL = `${HAWKEYE_REPOSITORY_URL}/blob/main/CONTRIBUTING.md`;
export const LICENSE_URL = `${HAWKEYE_REPOSITORY_URL}/blob/main/LICENSE`;
export const NPM_URL = "https://www.npmjs.com/package/hawkeye-review";

export function SiteFooter() {
  return (
    <footer className="ld-foot">
      <span className="hk-mono hk-lockup">
        <Mark />
        hawkeye
      </span>
      <a href={LICENSE_URL}>Open source, MIT</a>
      <a href={SELF_HOSTING_URL}>Self-host</a>
      <a href="/security">Security</a>
      <a href={NPM_URL}>npm: hawkeye-review</a>
    </footer>
  );
}
