import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeHarness, writeHarnessSettings } from "./claude-code.js";

async function fakeClaude(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hawkeye-claude-"));
  const file = join(dir, "claude");
  await writeFile(file, `#!/usr/bin/env bash\n${script}\n`);
  await chmod(file, 0o755);
  return file;
}

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "hawkeye-run-"));
  const promptPath = join(dir, "prompt.md");
  await writeFile(promptPath, "prompt");
  return {
    dir,
    promptPath,
    resultPath: join(dir, "result.json"),
    settingsPath: join(dir, "settings.json"),
  };
}

const input = (
  s: Awaited<ReturnType<typeof scratch>>,
  extra: Partial<Parameters<ReturnType<typeof createClaudeCodeHarness>["run"]>[0]> = {},
) => ({
  cwd: s.dir,
  promptPath: s.promptPath,
  resultPath: s.resultPath,
  settingsPath: s.settingsPath,
  maxTurns: 5,
  wallClockMs: 10_000,
  onEvent: () => {},
  ...extra,
});

describe("claude code harness", () => {
  it("passes the expected flags and reports ok when the result exists", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; echo '{"type":"assistant"}'; echo '{"type":"result"}'; echo '{"ok":true}' > "${s.resultPath}"`,
    );
    const events: unknown[] = [];
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { onEvent: (e) => events.push(e) }),
    );
    expect(result).toEqual({ status: "ok", turns: 1 });
    const args = (await readFile(join(exe, "..", "args"), "utf8")).split("\n");
    expect(args.slice(0, 2)).toEqual(["-p", "prompt"]);
    for (const flag of [
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--allowedTools",
      "Bash",
      "--disallowedTools",
      "WebFetch",
      "--settings",
    ])
      expect(args).toContain(flag);
    expect(events).toContainEqual({ type: "turn", turns: 1 });
  });
  it("reports error when the process exits without a result", async () => {
    const s = await scratch();
    const exe = await fakeClaude(`echo boom >&2; exit 3`);
    const result = await createClaudeCodeHarness({ executable: exe }).run(input(s));
    expect(result.status).toBe("error");
    expect(result.error).toContain("boom");
  });
  it("stops at the turn limit", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `for i in 1 2 3 4 5 6 7 8; do echo '{"type":"assistant"}'; sleep 0.05; done; sleep 5`,
    );
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { maxTurns: 3 }),
    );
    expect(result.status).toBe("max-turns");
    expect(result.turns).toBeGreaterThanOrEqual(4);
  });
  it("times out on the wall clock", async () => {
    const s = await scratch();
    const exe = await fakeClaude(`sleep 5`);
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { wallClockMs: 300 }),
    );
    expect(result.status).toBe("timeout");
  });
  it("writes a stop hook that blocks until the result exists", async () => {
    const s = await scratch();
    await writeHarnessSettings(s.settingsPath, s.resultPath);
    const settings = JSON.parse(await readFile(s.settingsPath, "utf8"));
    const command: string = settings.hooks.Stop[0].hooks[0].command;
    expect(command).toContain(s.resultPath);
    expect(command).toContain("exit 2");
  });
});
