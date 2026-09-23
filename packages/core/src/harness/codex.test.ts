import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexHarness, reviewResultJsonSchema } from "./codex.js";

const result = {
  verdict: "ship",
  summary: "fine",
  lenses: ["intent", "behavior", "blast_radius", "verification", "fit", "hygiene"].map((name) => ({
    name,
    assessment: "ok",
  })),
  findings: [],
};

async function fakeCodex(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hawkeye-codex-"));
  const file = join(dir, "codex");
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
    settingsPath: join(dir, "schema.json"),
  };
}

const input = (
  s: Awaited<ReturnType<typeof scratch>>,
  extra: Partial<Parameters<ReturnType<typeof createCodexHarness>["run"]>[0]> = {},
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

describe("codex harness", () => {
  it("passes the exec flags, the schema and the prompt, and reports ok when the result exists", async () => {
    const s = await scratch();
    const exe = await fakeCodex(
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; cat > "$(dirname "$0")/stdin"; echo '{"type":"thread.started","thread_id":"t"}'; echo '{"type":"item.completed","item":{"type":"command_execution"}}'; echo '${JSON.stringify(result)}' > "${s.resultPath}"`,
    );
    const turns: number[] = [];
    const outcome = await createCodexHarness({ executable: exe, model: "gpt-5.5" }).run(
      input(s, { onEvent: (event) => event.type === "turn" && turns.push(event.turns) }),
    );
    expect(outcome).toEqual({ status: "ok", turns: 1 });
    expect(turns).toEqual([1]);
    const args = (await readFile(join(exe, "..", "args"), "utf8")).trim().split("\n");
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--ephemeral");
    expect(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2)).toEqual([
      "--sandbox",
      "workspace-write",
    ]);
    expect(args.slice(args.indexOf("--add-dir"), args.indexOf("--add-dir") + 2)).toEqual([
      "--add-dir",
      s.dir,
    ]);
    expect(args.slice(args.indexOf("--cd"), args.indexOf("--cd") + 2)).toEqual(["--cd", s.dir]);
    expect(
      args.slice(args.indexOf("--output-schema"), args.indexOf("--output-schema") + 2),
    ).toEqual(["--output-schema", s.settingsPath]);
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
      "--model",
      "gpt-5.5",
    ]);
    expect(args.at(-1)).toBe("-");
    expect(await readFile(join(exe, "..", "stdin"), "utf8")).toBe("prompt");
    const schema = JSON.parse(await readFile(s.settingsPath, "utf8")) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toContain("verdict");
  });

  it("adopts the last message as the result when the model answered instead of writing the file", async () => {
    const s = await scratch();
    const exe = await fakeCodex(
      `while [ "$1" != "--output-last-message" ]; do shift; done; cat > /dev/null; { echo '\`\`\`json'; echo '${JSON.stringify(result)}'; echo '\`\`\`'; } > "$2"`,
    );
    const outcome = await createCodexHarness({ executable: exe }).run(input(s));
    expect(outcome).toEqual({ status: "ok", turns: 0 });
    expect(JSON.parse(await readFile(s.resultPath, "utf8"))).toEqual(result);
  });

  it("does not adopt a last message that is not a review result", async () => {
    const s = await scratch();
    const exe = await fakeCodex(
      `while [ "$1" != "--output-last-message" ]; do shift; done; cat > /dev/null; echo 'I could not review this.' > "$2"; exit 0`,
    );
    const outcome = await createCodexHarness({ executable: exe }).run(input(s));
    expect(outcome).toMatchObject({ status: "error", turns: 0 });
    expect(outcome.error).toContain("codex exited with 0");
  });

  it("keeps error events and stderr in the run error", async () => {
    const s = await scratch();
    const exe = await fakeCodex(
      `cat > /dev/null; echo '{"type":"error","message":"Reconnecting... 1/5 (stream disconnected)"}'; echo 'not logged in' >&2; exit 1`,
    );
    const outcome = await createCodexHarness({ executable: exe }).run(input(s));
    expect(outcome.status).toBe("error");
    expect(outcome.error).toContain("Reconnecting... 1/5");
    expect(outcome.error).toContain("not logged in");
  });

  it("stops at the turn limit", async () => {
    const s = await scratch();
    const exe = await fakeCodex(
      `cat > /dev/null; for i in 1 2 3; do echo '{"type":"item.completed","item":{"type":"agent_message"}}'; done; sleep 5`,
    );
    const outcome = await createCodexHarness({ executable: exe }).run(input(s, { maxTurns: 2 }));
    expect(outcome).toEqual({ status: "max-turns", turns: 2 });
  });

  it("names a missing codex binary", async () => {
    const s = await scratch();
    await expect(
      createCodexHarness({ executable: join(s.dir, "missing-codex") }).run(input(s)),
    ).rejects.toThrow(/ENOENT/);
  });

  it("describes the review result as a JSON schema with the verdict words", () => {
    const schema = reviewResultJsonSchema() as {
      properties: { verdict: { enum: string[] } };
    };
    expect(schema.properties.verdict.enum).toEqual([
      "ship",
      "mergeable",
      "changes_needed",
      "blocked",
    ]);
  });
});
