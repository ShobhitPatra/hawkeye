import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requestRunnerStatus } from "@/request-runner-status";
import { getSession } from "@/session";
import { parseTheme, THEME_COOKIE } from "@/theme";
import { TopBar } from "./top-bar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) return children;
  const [runner, cookieStore] = await Promise.all([
    requestRunnerStatus(session.user.id),
    cookies(),
  ]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  return (
    <>
      <TopBar user={session.user} runner={runner} theme={theme} />
      {children}
    </>
  );
}
