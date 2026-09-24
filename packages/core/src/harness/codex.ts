import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { parseReviewResult } from "../contract/schema.js";
import type { SpawnLike } from "./claude-code.js";
import { runCliProcess } from "./cli-process.js";
import type { HarnessResult, HarnessRunInput, HarnessSpec } from "./harness.js";

const STEP_ITEMS = new Set(["agent_message", "command_execution", "file_change", "mcp_tool_call"]);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

async function adoptLastMessage(lastMessagePath: string, resultPath: string): Promise<boolean> {
  if (!(await exists(lastMessagePath))) return false;
  const text = (await readFile(lastMessagePath, "utf8")).trim();
  const body = text.startsWith("```")
    ? text.replace(/^```(?:json)?\n?/, "").replace(/```$/, "")
    : text;
  try {
    parseReviewResult(JSON.parse(body));
  } catch {
    return false;
  }
  await writeFile(resultPath, body);
  return true;
}

export function createCodexHarness(
  options: { executable?: string; spawn?: SpawnLike; model?: string } = {},
): HarnessSpec {
  if (options.model !== undefined && options.model.trim() === "")
    throw new Error("model must not be empty");
  const executable = options.executable ?? "codex";
  const spawn = options.spawn ?? nodeSpawn;

  return {
    name: "codex",
    async run(input: HarnessRunInput): Promise<HarnessResult> {
      const model = options.model ?? input.model;
      const prompt = await readFile(input.promptPath, "utf8");
      const lastMessagePath = join(dirname(input.resultPath), "last-message.txt");
      let turns = 0;
      const { exitCode, stopReason, errorTail } = await runCliProcess({
        spawn,
        executable,
        args: [
          "exec",
          "--json",
          "--color",
          "never",
          "--skip-git-repo-check",
          "--ephemeral",
          "--sandbox",
          "workspace-write",
          "--add-dir",
          dirname(input.resultPath),
          "--cd",
          input.cwd,
          "--output-last-message",
          lastMessagePath,
          ...(model === undefined ? [] : ["--model", model]),
          "-",
        ],
        cwd: input.cwd,
        stdin: prompt,
        wallClockMs: input.wallClockMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onStdoutLine: (line, control) => {
          input.onEvent({ type: "stdout", line });
          let parsed: { type?: string; message?: unknown; item?: { type?: string } } | undefined;
          try {
            parsed = JSON.parse(line) as typeof parsed;
          } catch {
            return;
          }
          if (parsed?.type === "error" && typeof parsed.message === "string")
            control.keep(parsed.message);
          if (
            parsed?.type === "item.completed" &&
            STEP_ITEMS.has(parsed.item?.type ?? "") &&
            !control.stopped
          ) {
            turns += 1;
            input.onEvent({ type: "turn", turns });
            if (turns >= input.maxTurns) control.stop("max-turns");
          }
        },
        onStderrLine: (line) => input.onEvent({ type: "stderr", line }),
      });

      if (await exists(input.resultPath)) return { status: "ok", turns };
      if (await adoptLastMessage(lastMessagePath, input.resultPath)) return { status: "ok", turns };
      if (stopReason) return { status: stopReason, turns };
      return {
        status: "error",
        turns,
        error: `codex exited with ${exitCode ?? "signal"}${errorTail.length ? `: ${errorTail.join("\n")}` : ""}`,
      };
    },
  };
}
