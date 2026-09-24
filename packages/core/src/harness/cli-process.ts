import { createInterface } from "node:readline";
import type { SpawnLike } from "./claude-code.js";

const KILL_GRACE_MS = 5_000;
const ERROR_TAIL_LINES = 50;

export type StopReason = "max-turns" | "timeout" | "superseded";

export type CliProcessOutcome = {
  exitCode: number | null;
  stopReason: StopReason | undefined;
  errorTail: string[];
};

export async function runCliProcess(input: {
  spawn: SpawnLike;
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  wallClockMs: number;
  signal?: AbortSignal;
  onStdoutLine(
    line: string,
    control: { keep(line: string): void; stop(reason: StopReason): void },
  ): void;
  onStderrLine(line: string): void;
}): Promise<CliProcessOutcome> {
  const child = input.spawn(input.executable, input.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  let stopReason: StopReason | undefined;
  const errorTail: string[] = [];
  const keep = (line: string) => {
    errorTail.push(line);
    if (errorTail.length > ERROR_TAIL_LINES) errorTail.shift();
  };

  child.stdin!.on("error", (error: Error) => {
    const line = `stdin: ${error.message}`;
    input.onStderrLine(line);
    keep(line);
  });
  child.stdin!.end(input.stdin);

  const killGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const stop = (reason: StopReason) => {
    if (stopReason) return;
    stopReason = reason;
    killGroup("SIGTERM");
    setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
  };
  const timer = setTimeout(() => stop("timeout"), input.wallClockMs);
  const abort = () => stop("superseded");
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener("abort", abort, { once: true });

  createInterface({ input: child.stdout! }).on("line", (line) =>
    input.onStdoutLine(line, { keep, stop }),
  );
  createInterface({ input: child.stderr! }).on("line", (line) => {
    input.onStderrLine(line);
    keep(line);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  }).finally(() => {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  });
  return { exitCode, stopReason, errorTail };
}
