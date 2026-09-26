export const MAX_QUIET_WINDOW_SECONDS = 600;

export type ReviewSettings = {
  autoReview: boolean;
  reviewDrafts: boolean;
  quietWindowSeconds: number;
};

export const HARNESSES = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
] as const;
export type HarnessChoice = (typeof HARNESSES)[number]["value"];

export function isHarnessChoice(value: string): value is HarnessChoice {
  return HARNESSES.some((harness) => harness.value === value);
}

export const MODELS = [
  { harness: "claude-code", value: "claude-fable-5-1", label: "Fable 5.1", hint: "most capable" },
  { harness: "claude-code", value: "claude-opus-5-5", label: "Opus 5.5", hint: "balanced" },
  { harness: "claude-code", value: "claude-sonnet-5", label: "Sonnet 5", hint: "fastest" },
  { harness: "codex", value: "gpt-6-astra", label: "GPT-6-Astra", hint: "most capable" },
  { harness: "codex", value: "gpt-6-sol", label: "GPT-6-Sol", hint: "balanced" },
  { harness: "codex", value: "gpt-6-luna", label: "GPT-6-Luna", hint: "fastest" },
] as const;

export const RETIRED_MODELS = [
  { harness: "claude-code", value: "claude-fable-5", label: "Fable 5" },
  { harness: "claude-code", value: "claude-opus-5", label: "Opus 5" },
  { harness: "claude-code", value: "claude-opus-4-8", label: "Opus 4.8" },
] as const;

export function isModelChoice(harness: string, value: string): boolean {
  return MODELS.some((model) => model.harness === harness && model.value === value);
}

export function retiredModel(
  harness: string,
  value: string,
): (typeof RETIRED_MODELS)[number] | undefined {
  return RETIRED_MODELS.find((model) => model.harness === harness && model.value === value);
}

export function modelFor(harness: string, model: string | null): string | undefined {
  if (model === null) return undefined;
  return isModelChoice(harness, model) || retiredModel(harness, model) ? model : undefined;
}
export const MAX_TURNS_RANGE = { min: 1, max: 200 } as const;
export const WALL_CLOCK_MINUTES_RANGE = { min: 1, max: 60 } as const;
export const CONCURRENCY_RANGE = { min: 1, max: 3 } as const;

export type RunnerSettings = {
  harness: string;
  model: string | null;
  maxTurns: number;
  wallClockMinutes: number;
  concurrency: number;
};
