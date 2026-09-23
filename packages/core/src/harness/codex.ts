import { spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import { parseReviewResult, ReviewResultSchema } from "../contract/schema.js";
import type { SpawnLike } from "./claude-code.js";
import type { HarnessResult, HarnessRunInput, HarnessSpec } from "./harness.js";

const KILL_GRACE_MS = 5_000;
const STEP_ITEMS = new Set(["agent_message", "command_execution", "file_change", "mcp_tool_call"]);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

export function reviewResultJsonSchema(): unknown {
  return z.toJSONSchema(ReviewResultSchema, { io: "input", unrepresentable: "any" });
}

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
      await writeFile(input.settingsPath, JSON.stringify(reviewResultJsonSchema(), null, 2));
      const lastMessagePath = join(dirname(input.resultPath), "last-message.txt");
      const args = [
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
        "--output-schema",
        input.settingsPath,
        "--output-last-message",
        lastMessagePath,
        ...(model === undefined ? [] : ["--model", model]),
        "-",
      ];
      const child = spawn(executable, args, {
        cwd: input.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let turns = 0;
      let stopReason: "max-turns" | "timeout" | "superseded" | undefined;
      const errorTail: string[] = [];
      const keep = (line: string) => {
        errorTail.push(line);
        if (errorTail.length > 50) errorTail.shift();
      };

      child.stdin!.on("error", (error: Error) => {
        const line = `stdin: ${error.message}`;
        input.onEvent({ type: "stderr", line });
        keep(line);
      });
      child.stdin!.end(prompt);

      const killGroup = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      const terminate = (reason: "max-turns" | "timeout" | "superseded") => {
        if (stopReason) return;
        stopReason = reason;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
      };
      const timer = setTimeout(() => terminate("timeout"), input.wallClockMs);
      const abort = () => terminate("superseded");
      if (input.signal?.aborted) abort();
      else input.signal?.addEventListener("abort", abort, { once: true });

      createInterface({ input: child.stdout! }).on("line", (line) => {
        input.onEvent({ type: "stdout", line });
        let parsed: { type?: string; message?: unknown; item?: { type?: string } } | undefined;
        try {
          parsed = JSON.parse(line) as typeof parsed;
        } catch {
          return;
        }
        if (parsed?.type === "error" && typeof parsed.message === "string") keep(parsed.message);
        if (
          parsed?.type === "item.completed" &&
          STEP_ITEMS.has(parsed.item?.type ?? "") &&
          stopReason === undefined
        ) {
          turns += 1;
          input.onEvent({ type: "turn", turns });
          if (turns >= input.maxTurns) terminate("max-turns");
        }
      });
      createInterface({ input: child.stderr! }).on("line", (line) => {
        input.onEvent({ type: "stderr", line });
        keep(line);
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      }).finally(() => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
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
