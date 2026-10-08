export type PlanLimit = "rate limit" | "overload";

const RATE_LIMIT =
  /rate_limit_error|API Error: 429\b|last status: 429\b|usage limit reached|hit your [\w ]*limit|Quota exceeded/i;
const OVERLOAD =
  /overloaded_error|API Error: 529\b|Repeated 529|experiencing high load|temporarily limiting requests|model is at capacity|capacity unavailable/i;

export function planLimitIn(error: string): PlanLimit | undefined {
  if (RATE_LIMIT.test(error)) return "rate limit";
  if (OVERLOAD.test(error)) return "overload";
  return undefined;
}
