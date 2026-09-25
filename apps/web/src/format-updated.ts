const DAY_MS = 24 * 60 * 60 * 1000;
const UNITS = [
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
] as const;

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const absoluteDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatUpdated(updatedAt: string, now: number): string {
  const elapsed = new Date(updatedAt).getTime() - now;
  if (Math.abs(elapsed) >= DAY_MS) return absoluteDate.format(new Date(updatedAt));
  for (const { unit, ms } of UNITS) {
    if (Math.abs(elapsed) >= ms) return relativeTime.format(Math.trunc(elapsed / ms), unit);
  }
  return relativeTime.format(Math.trunc(elapsed / 1000), "second");
}
