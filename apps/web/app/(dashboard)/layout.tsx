import type { ReactNode } from "react";
import { getDb } from "@/db";
import { runnerStatus } from "@/runner-status";
import { requireSession } from "@/session";
import { TopBar } from "./top-bar";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const runner = await runnerStatus(getDb(), session.user.id);
  return (
    <>
      <TopBar user={session.user} runner={runner} />
      {children}
    </>
  );
}
