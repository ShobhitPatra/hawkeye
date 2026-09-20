import { notFound } from "next/navigation";
import { isAdmin } from "@/admin";
import { getDb } from "@/db";
import { env } from "@/env";
import { loadFunnel } from "@/funnel";
import { requireSession } from "@/session";
import { FunnelView } from "./funnel-view";

export default async function FunnelPage() {
  const session = await requireSession();
  if (!isAdmin(session.user.githubLogin, env.adminLogins())) notFound();
  return <FunnelView funnel={await loadFunnel(getDb())} />;
}
