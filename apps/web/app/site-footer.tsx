import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";
import { Mark } from "./mark";

export const REVIEWS_URL = `${HAWKEYE_REPOSITORY_URL}/pulls?q=is%3Apr`;
export const CONTRIBUTING_URL = `${HAWKEYE_REPOSITORY_URL}/blob/main/CONTRIBUTING.md`;
export const LICENSE_URL = `${HAWKEYE_REPOSITORY_URL}/blob/main/LICENSE`;
export const NPM_URL = "https://www.npmjs.com/package/hawkeye-review";

export function SiteFooter() {
  return (
    <footer className="hk-footer">
      <span className="hk-mono hk-lockup">
        <Mark />
        hawkeye
      </span>
      <a href={LICENSE_URL}>Open source, MIT</a>
      <a href={REVIEWS_URL}>Reviews</a>
      <a href="/security">Security</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href={NPM_URL}>npm: hawkeye-review</a>
    </footer>
  );
}
