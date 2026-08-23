const UNITS = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatUpdated(updatedAt: string, now: number): string {
  const elapsed = new Date(updatedAt).getTime() - now;
  for (const { unit, ms } of UNITS) {
    if (Math.abs(elapsed) >= ms) return relativeTime.format(Math.round(elapsed / ms), unit);
  }
  return relativeTime.format(Math.round(elapsed / 1000), "second");
}
