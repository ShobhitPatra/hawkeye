export const REFRESH_INTERVAL_MS = 15_000;

export function shouldRefresh(input: { visible: boolean; pending: boolean }): boolean {
  return input.visible && !input.pending;
}

export function updatedAgo(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `Updated ${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  return `Updated ${minutes} min ago`;
}
