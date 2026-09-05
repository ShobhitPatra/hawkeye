import type { ReactNode } from "react";
import { requestRunnerStatus } from "@/request-runner-status";
import { getSession } from "@/session";
import { TopBar } from "./top-bar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) return children;
  const runner = await requestRunnerStatus(session.user.id);
  return (
    <>
      <TopBar user={session.user} runner={runner} />
      {children}
    </>
  );
}
