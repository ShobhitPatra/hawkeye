export const MAX_QUIET_WINDOW_SECONDS = 600;

export type ReviewSettings = {
  autoReview: boolean;
  reviewDrafts: boolean;
  quietWindowSeconds: number;
};

export const MODELS = [
  { value: "claude-fable-5-1", label: "Fable 5.1" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-opus-5", label: "Opus 5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-sonnet-5", label: "Sonnet 5" },
] as const;
export type ModelChoice = (typeof MODELS)[number]["value"];

export function isModelChoice(value: string): value is ModelChoice {
  return MODELS.some((model) => model.value === value);
}
export const MAX_TURNS_RANGE = { min: 1, max: 200 } as const;
export const WALL_CLOCK_MINUTES_RANGE = { min: 1, max: 60 } as const;
export const CONCURRENCY_RANGE = { min: 1, max: 3 } as const;

export type RunnerSettings = {
  model: string | null;
  maxTurns: number;
  wallClockMinutes: number;
  concurrency: number;
};
