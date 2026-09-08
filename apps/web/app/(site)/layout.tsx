import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/theme";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import "../landing.css";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="ld-frame">
      <SiteHeader theme={theme} />
      <div className="ld-scroll">
        <main className="hk-page">
          <article className="ld-doc hk-body">{children}</article>
        </main>
      </div>
      <div className="hk-page ld-frame-foot">
        <SiteFooter />
      </div>
    </div>
  );
}
