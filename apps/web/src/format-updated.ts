const DAY_MS = 24 * 60 * 60 * 1000;
const UNITS = [
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function absoluteDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatUpdated(updatedAt: string, now: number): string {
  const elapsed = new Date(updatedAt).getTime() - now;
  if (Math.abs(elapsed) >= DAY_MS) return absoluteDate(new Date(updatedAt));
  for (const { unit, ms } of UNITS) {
    if (Math.abs(elapsed) >= ms) return relativeTime.format(Math.trunc(elapsed / ms), unit);
  }
  return relativeTime.format(Math.trunc(elapsed / 1000), "second");
}
