import { spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { runCliProcess } from "./cli-process.js";
import type { HarnessResult, HarnessRunInput, HarnessSpec } from "./harness.js";

export type SpawnLike = typeof nodeSpawn;

const DISALLOWED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"];

async function writeHarnessSettings(settingsPath: string, resultPath: string): Promise<void> {
  const command = `test -f '${resultPath}' || { echo 'Write the review result JSON to ${resultPath} before stopping.' >&2; exit 2; }`;
  await writeFile(
    settingsPath,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command }] }] } }, null, 2),
  );
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

export function createClaudeCodeHarness(
  options: { executable?: string; spawn?: SpawnLike; model?: string } = {},
): HarnessSpec {
  if (options.model !== undefined && options.model.trim() === "")
    throw new Error("model must not be empty");
  const executable = options.executable ?? "claude";
  const spawn = options.spawn ?? nodeSpawn;

  return {
    name: "claude-code",
    async run(input: HarnessRunInput): Promise<HarnessResult> {
      const model = options.model ?? input.model;
      const prompt = await readFile(input.promptPath, "utf8");
      await writeHarnessSettings(input.settingsPath, input.resultPath);
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--disallowedTools",
        ...DISALLOWED_TOOLS,
        "--setting-sources",
        "user",
        "--settings",
        input.settingsPath,
        ...(model === undefined ? [] : ["--model", model]),
      ];
      let turns = 0;
      let lastMessageId: string | undefined;
      const {
        exitCode,
        stopReason,
        errorTail: stderrTail,
      } = await runCliProcess({
        spawn,
        executable,
        args,
        cwd: input.cwd,
        stdin: prompt,
        wallClockMs: input.wallClockMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onStdoutLine: (line, control) => {
          input.onEvent({ type: "stdout", line });
          let parsed:
            | { type?: string; message?: { id?: string }; is_error?: boolean; result?: unknown }
            | undefined;
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            return;
          }
          if (
            parsed?.type === "result" &&
            parsed.is_error === true &&
            typeof parsed.result === "string"
          )
            control.keep(parsed.result);
          if (parsed?.type === "assistant" && !control.stopped) {
            const messageId = parsed.message?.id;
            if (messageId !== undefined && messageId === lastMessageId) return;
            lastMessageId = messageId;
            turns += 1;
            input.onEvent({ type: "turn", turns });
            if (turns >= input.maxTurns) control.stop("max-turns");
          }
        },
        onStderrLine: (line) => input.onEvent({ type: "stderr", line }),
      });

      const hasResult = await exists(input.resultPath);
      if (hasResult) return { status: "ok", turns };
      if (stopReason) return { status: stopReason, turns };
      if (model !== undefined && stderrTail.some((line) => line.includes("unrecognized_model"))) {
        if (options.model !== undefined)
          return {
            status: "error",
            turns,
            error: `Model ${model} was refused by the claude CLI; start the runner with another --model or without it.`,
          };
        return {
          status: "error",
          turns,
          error: `Model ${model} was refused by the claude CLI; choose another in Settings.`,
          refusedModel: model,
        };
      }
      return {
        status: "error",
        turns,
        error: `claude exited with ${exitCode ?? "signal"}${stderrTail.length ? `: ${stderrTail.join("\n")}` : ""}`,
      };
    },
  };
}
