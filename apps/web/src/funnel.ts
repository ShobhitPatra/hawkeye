import { sql } from "drizzle-orm";
import type { Db } from "./db/client";

export const FUNNEL_STEPS = ["signedIn", "installed", "connected", "online", "reviewed"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export type FunnelCounts = Record<FunnelStep, number>;
export type FunnelWeek = FunnelCounts & { weekStart: string };
export type Funnel = { total: FunnelCounts; weeks: FunnelWeek[] };

type Row = { week_start: string } & Record<
  "signed_in" | "installed" | "connected" | "online" | "reviewed",
  number
>;

export async function loadFunnel(db: Db): Promise<Funnel> {
  const result = (await db.execute(sql`
    select to_char(date_trunc('week', u.created_at), 'YYYY-MM-DD') as week_start,
           count(*)::int as signed_in,
           count(*) filter (where exists (
             select 1 from installation_user iu where iu.user_id = u.id))::int as installed,
           count(*) filter (where exists (
             select 1 from runner r where r.user_id = u.id))::int as connected,
           count(*) filter (where exists (
             select 1 from runner r where r.user_id = u.id and r.first_seen_at is not null))::int as online,
           count(*) filter (where exists (
             select 1 from review_posted p
             join armed_pr a on a.id = p.armed_pr_id
             where a.user_id = u.id and p.github_review_id is not null))::int as reviewed
    from "user" u
    group by 1
    order by 1 desc
  `)) as { rows: Row[] };

  const weeks = result.rows.map((row) => ({
    weekStart: row.week_start,
    signedIn: row.signed_in,
    installed: row.installed,
    connected: row.connected,
    online: row.online,
    reviewed: row.reviewed,
  }));
  const total: FunnelCounts = { signedIn: 0, installed: 0, connected: 0, online: 0, reviewed: 0 };
  for (const week of weeks) for (const step of FUNNEL_STEPS) total[step] += week[step];
  return { total, weeks };
}

export function keptFromPrevious(counts: FunnelCounts, step: FunnelStep): number | undefined {
  const index = FUNNEL_STEPS.indexOf(step);
  if (index === 0) return undefined;
  const previous = counts[FUNNEL_STEPS[index - 1]!];
  return previous === 0 ? undefined : Math.round((counts[step] / previous) * 100);
}
