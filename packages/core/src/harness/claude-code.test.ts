import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeHarness } from "./claude-code.js";

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
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; cat > "$(dirname "$0")/stdin"; echo '{"type":"assistant"}'; echo '{"type":"result"}'; echo '{"ok":true}' > "${s.resultPath}"`,
    );
    const events: unknown[] = [];
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { onEvent: (e) => events.push(e) }),
    );
    expect(result).toEqual({ status: "ok", turns: 1 });
    const args = (await readFile(join(exe, "..", "args"), "utf8")).split("\n");
    expect(args[0]).toBe("-p");
    expect(args).not.toContain("prompt");
    expect(await readFile(join(exe, "..", "stdin"), "utf8")).toBe("prompt");
    for (const flag of [
      "--output-format",
      "stream-json",
      "--permission-mode",
      "bypassPermissions",
      "--disallowedTools",
      "Edit",
      "Write",
      "NotebookEdit",
      "WebFetch",
      "--settings",
    ])
      expect(args).toContain(flag);
    expect(args).not.toContain("--allowedTools");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("user");
    expect(events).toContainEqual({ type: "turn", turns: 1 });
  });
  it("stops with superseded when the signal aborts", async () => {
    const exe = await fakeClaude("sleep 5");
    const s = await scratch();
    const control = new AbortController();
    setTimeout(() => control.abort(), 50);
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { signal: control.signal }),
    );
    expect(result).toEqual({ status: "superseded", turns: 0 });
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
    expect(result.turns).toBeGreaterThanOrEqual(3);
    expect(result.turns).toBeLessThanOrEqual(3);
  });
  it("counts one turn per assistant message id", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `echo '{"type":"assistant","message":{"id":"a"}}'; echo '{"type":"assistant","message":{"id":"a"}}'; echo '{"type":"assistant","message":{"id":"b"}}'; echo '{"ok":true}' > "${s.resultPath}"`,
    );
    const result = await createClaudeCodeHarness({ executable: exe }).run(input(s));
    expect(result).toEqual({ status: "ok", turns: 2 });
  });
  it("times out on the wall clock", async () => {
    const s = await scratch();
    const exe = await fakeClaude(`sleep 5`);
    const result = await createClaudeCodeHarness({ executable: exe }).run(
      input(s, { wallClockMs: 300 }),
    );
    expect(result.status).toBe("timeout");
  });
  it("writes a stop hook that blocks until the result exists before spawning", async () => {
    const s = await scratch();
    const exe = await fakeClaude(`cat "${s.settingsPath}" > "$(dirname "$0")/settings"; exit 0`);
    await createClaudeCodeHarness({ executable: exe }).run(input(s));
    const settings = JSON.parse(await readFile(join(exe, "..", "settings"), "utf8"));
    const command: string = settings.hooks.Stop[0].hooks[0].command;
    expect(command).toContain(s.resultPath);
    expect(command).toContain("exit 2");
  });

  it("passes the model through to the claude CLI", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; echo '{"type":"result"}'; exit 0`,
    );
    await createClaudeCodeHarness({ executable: exe, model: "opus" }).run(input(s));
    const args = (await readFile(join(exe, "..", "args"), "utf8")).split("\n");
    const at = args.indexOf("--model");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("opus");
    expect(() => createClaudeCodeHarness({ model: " " })).toThrow("model must not be empty");
  });

  it("names a refused model and where to change it", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `echo '[claude-code:unrecognized_model] {"model":"claude-fable-5-1"}' >&2; exit 1`,
    );
    await expect(
      createClaudeCodeHarness({ executable: exe }).run({ ...input(s), model: "claude-fable-5-1" }),
    ).resolves.toMatchObject({
      status: "error",
      error: "Model claude-fable-5-1 was refused by the claude CLI; choose another in Settings.",
    });
    await expect(
      createClaudeCodeHarness({ executable: exe, model: "claude-fable-5-1" }).run(input(s)),
    ).resolves.toMatchObject({
      error:
        "Model claude-fable-5-1 was refused by the claude CLI; start the runner with another --model or without it.",
    });
  });

  it("uses the job's model unless the harness was started with one", async () => {
    const s = await scratch();
    const exe = await fakeClaude(
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; echo '{"type":"result"}'; exit 0`,
    );
    const modelArgument = async () => {
      const args = (await readFile(join(exe, "..", "args"), "utf8")).split("\n");
      return args[args.indexOf("--model") + 1];
    };
    await createClaudeCodeHarness({ executable: exe }).run({ ...input(s), model: "sonnet" });
    expect(await modelArgument()).toBe("sonnet");
    await createClaudeCodeHarness({ executable: exe, model: "opus" }).run({
      ...input(s),
      model: "sonnet",
    });
    expect(await modelArgument()).toBe("opus");
  });
});
