export type HarnessEvent =
  | { type: "turn"; turns: number }
  | { type: "stdout"; line: string }
  | { type: "stderr"; line: string };
export type HarnessResult = {
  status: "ok" | "max-turns" | "timeout" | "error" | "superseded";
  turns: number;
  error?: string;
  refusedModel?: string;
};
export type HarnessRunInput = {
  cwd: string;
  promptPath: string;
  resultPath: string;
  settingsPath: string;
  maxTurns: number;
  wallClockMs: number;
  model?: string;
  signal?: AbortSignal;
  onEvent(event: HarnessEvent): void;
};
export interface HarnessSpec {
  name: string;
  run(input: HarnessRunInput): Promise<HarnessResult>;
}
