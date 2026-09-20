import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/theme";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./landing.css";

export const metadata = { title: "Not found, Hawkeye" };

export default async function NotFound() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="ld-frame">
      <SiteHeader theme={theme} />
      <div className="ld-scroll">
        <main className="hk-page">
          <div className="hk-state">
            <p>There is no page at this address.</p>
            <p>
              The link may be wrong, or the page may have moved. <a href="/">Go to the start</a>.
            </p>
          </div>
        </main>
      </div>
      <div className="hk-page ld-frame-foot">
        <SiteFooter />
      </div>
    </div>
  );
}
