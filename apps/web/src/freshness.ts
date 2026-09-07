export const REFRESH_INTERVAL_MS = 15_000;
export const REFRESH_DEBOUNCE_MS = 1_000;

export function shouldRefresh(input: {
  visible: boolean;
  pending: boolean;
  sinceLastStartMs: number;
}): boolean {
  return input.visible && !input.pending && input.sinceLastStartMs >= REFRESH_DEBOUNCE_MS;
}
