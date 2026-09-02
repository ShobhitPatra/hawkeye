import { spawn as nodeSpawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { HarnessResult, HarnessRunInput, HarnessSpec } from "./harness.js";

export type SpawnLike = typeof nodeSpawn;

const DISALLOWED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"];
const KILL_GRACE_MS = 5_000;

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
  const executable = options.executable ?? "claude";
  const spawn = options.spawn ?? nodeSpawn;

  return {
    name: "claude-code",
    async run(input: HarnessRunInput): Promise<HarnessResult> {
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
        ...(options.model === undefined ? [] : ["--model", options.model]),
      ];
      const child = spawn(executable, args, {
        cwd: input.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });

      let turns = 0;
      let lastMessageId: string | undefined;
      let stopReason: "max-turns" | "timeout" | undefined;
      const stderrTail: string[] = [];

      child.stdin!.on("error", (error: Error) => {
        const line = `stdin: ${error.message}`;
        input.onEvent({ type: "stderr", line });
        stderrTail.push(line);
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
      const terminate = (reason: "max-turns" | "timeout") => {
        if (stopReason) return;
        stopReason = reason;
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS).unref();
      };
      const timer = setTimeout(() => terminate("timeout"), input.wallClockMs);

      createInterface({ input: child.stdout! }).on("line", (line) => {
        input.onEvent({ type: "stdout", line });
        let parsed: { type?: string; message?: { id?: string } } | undefined;
        try {
          parsed = JSON.parse(line) as { type?: string; message?: { id?: string } };
        } catch {
          return;
        }
        if (parsed?.type === "assistant") {
          const messageId = parsed.message?.id;
          if (messageId !== undefined && messageId === lastMessageId) return;
          lastMessageId = messageId;
          turns += 1;
          input.onEvent({ type: "turn", turns });
          if (turns >= input.maxTurns) terminate("max-turns");
        }
      });
      createInterface({ input: child.stderr! }).on("line", (line) => {
        input.onEvent({ type: "stderr", line });
        stderrTail.push(line);
        if (stderrTail.length > 50) stderrTail.shift();
      });

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      }).finally(() => clearTimeout(timer));

      const hasResult = await exists(input.resultPath);
      if (hasResult) return { status: "ok", turns };
      if (stopReason) return { status: stopReason, turns };
      return {
        status: "error",
        turns,
        error: `claude exited with ${exitCode ?? "signal"}${stderrTail.length ? `: ${stderrTail.join("\n")}` : ""}`,
      };
    },
  };
}
