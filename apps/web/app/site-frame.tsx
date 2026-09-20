import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getSession } from "@/session";
import { parseTheme, THEME_COOKIE } from "@/theme";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./landing.css";

export async function SiteFrame({ children }: { children: ReactNode }) {
  const [cookieStore, session] = await Promise.all([cookies(), getSession()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  return (
    <div className="ld-frame">
      <SiteHeader theme={theme} signedIn={Boolean(session)} />
      <div className="ld-scroll">
        <main className="hk-page">{children}</main>
      </div>
      <div className="hk-page ld-frame-foot">
        <SiteFooter />
      </div>
    </div>
  );
}
