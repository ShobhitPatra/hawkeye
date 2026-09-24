import { spawn as realSpawn } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeHarness } from "./claude-code.js";
import {
  containerRunArgs,
  createContainerSpawn,
  ensureRunnerImage,
  RUNNER_DOCKERFILE,
} from "./container.js";

async function fakeRuntime(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hawkeye-docker-"));
  const file = join(dir, "docker");
  await writeFile(file, `#!/usr/bin/env bash\n${script}\n`);
  await chmod(file, 0o755);
  return file;
}

describe("container spawn", () => {
  it("composes the run command with the mounts, the home and the working directory", () => {
    const args = containerRunArgs(
      {
        image: "hawkeye-runner",
        mounts: [
          { path: "/home/u/.cache/hawkeye/runs" },
          { path: "/home/u/.claude" },
          { path: "/home/u/.claude.json", readOnly: true },
        ],
        home: "/home/u",
        user: "1000:1000",
        cwd: "/home/u/.cache/hawkeye/runs/x/checkout",
      },
      "claude",
      ["-p", "--model", "opus"],
    );
    expect(args).toEqual([
      "run",
      "--rm",
      "-i",
      "--init",
      "--network",
      "host",
      "--user",
      "1000:1000",
      "-e",
      "HOME=/home/u",
      "-w",
      "/home/u/.cache/hawkeye/runs/x/checkout",
      "-v",
      "/home/u/.cache/hawkeye/runs:/home/u/.cache/hawkeye/runs",
      "-v",
      "/home/u/.claude:/home/u/.claude",
      "-v",
      "/home/u/.claude.json:/home/u/.claude.json:ro",
      "hawkeye-runner",
      "claude",
      "-p",
      "--model",
      "opus",
    ]);
  });

  it("runs the harness command through the runtime and passes stdin through", async () => {
    const runtime = await fakeRuntime(
      `printf '%s\\n' "$@" > "$(dirname "$0")/args"; cat > "$(dirname "$0")/stdin"; echo '{"type":"result"}'`,
    );
    const dir = await mkdtemp(join(tmpdir(), "hawkeye-run-"));
    const promptPath = join(dir, "prompt.md");
    await writeFile(promptPath, "prompt");
    const spawn = createContainerSpawn({
      runtime: "docker",
      mounts: [{ path: dir }],
      home: "/home/u",
      spawn: ((_command: string, args: readonly string[], options: object) =>
        realSpawn(runtime, args, options as never)) as never,
    });
    const outcome = await createClaudeCodeHarness({ spawn }).run({
      cwd: dir,
      promptPath,
      resultPath: join(dir, "result.json"),
      settingsPath: join(dir, "settings.json"),
      maxTurns: 5,
      wallClockMs: 10_000,
      onEvent: () => {},
    });
    expect(outcome.status).toBe("error");
    const args = (await readFile(join(runtime, "..", "args"), "utf8")).trim().split("\n");
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(args).toContain(`${dir}:${dir}`);
    expect(args[args.indexOf("hawkeye-runner") + 1]).toBe("claude");
    expect(await readFile(join(runtime, "..", "stdin"), "utf8")).toBe("prompt");
  });

  it("refuses a working directory outside the mounts", () => {
    const spawn = createContainerSpawn({
      runtime: "podman",
      mounts: [{ path: "/home/u/.cache/hawkeye/runs" }],
      home: "/home/u",
    });
    expect(() => spawn("claude", [], { cwd: "/home/u/secrets" })).toThrow(
      "not inside a mounted path",
    );
  });

  it("builds the image only when it is missing", async () => {
    const runtime = await fakeRuntime(
      `if [ "$1" = "image" ]; then [ -f "$(dirname "$0")/built" ]; exit $?; fi; if [ "$1" = "build" ]; then cat > "$(dirname "$0")/dockerfile"; touch "$(dirname "$0")/built"; exit 0; fi; exit 9`,
    );
    const spawn = ((_command: string, args: readonly string[], options: object) =>
      realSpawn(runtime, args, options as never)) as never;
    const lines: string[] = [];
    expect(await ensureRunnerImage("docker", { spawn, log: (line) => lines.push(line) })).toBe(
      "built",
    );
    expect(await readFile(join(runtime, "..", "dockerfile"), "utf8")).toBe(RUNNER_DOCKERFILE);
    expect(lines).toHaveLength(1);
    expect(await ensureRunnerImage("docker", { spawn })).toBe("present");
  });

  it("names a failed build", async () => {
    const runtime = await fakeRuntime(
      `if [ "$1" = "image" ]; then exit 1; fi; echo 'no space' >&2; exit 2`,
    );
    const spawn = ((_command: string, args: readonly string[], options: object) =>
      realSpawn(runtime, args, options as never)) as never;
    await expect(ensureRunnerImage("podman", { spawn })).rejects.toThrow(
      "podman build of hawkeye-runner failed with 2: no space",
    );
  });
});
