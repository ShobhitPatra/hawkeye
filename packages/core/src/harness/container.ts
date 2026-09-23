import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnLike } from "./claude-code.js";

export type ContainerRuntime = "docker" | "podman";
export type ContainerMount = { path: string; readOnly?: boolean };

export const RUNNER_IMAGE = "hawkeye-runner";
export const RUNNER_DOCKERFILE = [
  "FROM node:22-slim",
  "RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*",
  "RUN npm install -g @anthropic-ai/claude-code @openai/codex",
  "",
].join("\n");

export function containerRunArgs(
  options: {
    image: string;
    mounts: ContainerMount[];
    home: string;
    user?: string;
    cwd: string;
  },
  command: string,
  args: readonly string[],
): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--init",
    "--network",
    "host",
    ...(options.user === undefined ? [] : ["--user", options.user]),
    "-e",
    `HOME=${options.home}`,
    "-w",
    options.cwd,
    ...options.mounts.flatMap((mount) => [
      "-v",
      `${mount.path}:${mount.path}${mount.readOnly ? ":ro" : ""}`,
    ]),
    options.image,
    command,
    ...args,
  ];
}

export function createContainerSpawn(options: {
  runtime: ContainerRuntime;
  image?: string;
  mounts: ContainerMount[];
  home: string;
  user?: string;
  spawn?: SpawnLike;
}): SpawnLike {
  const spawn = options.spawn ?? nodeSpawn;
  const image = options.image ?? RUNNER_IMAGE;
  return ((command: string, args: readonly string[], spawnOptions: { cwd?: string }) => {
    const cwd = spawnOptions.cwd ?? process.cwd();
    if (!options.mounts.some((mount) => cwd === mount.path || cwd.startsWith(`${mount.path}/`)))
      throw new Error(`the working directory ${cwd} is not inside a mounted path`);
    return spawn(
      options.runtime,
      containerRunArgs(
        {
          image,
          mounts: options.mounts,
          home: options.home,
          ...(options.user === undefined ? {} : { user: options.user }),
          cwd,
        },
        command,
        args,
      ),
      spawnOptions as Parameters<SpawnLike>[2],
    );
  }) as SpawnLike;
}

function collect(child: ReturnType<SpawnLike>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

export async function ensureRunnerImage(
  runtime: ContainerRuntime,
  options: { image?: string; spawn?: SpawnLike; log?: (line: string) => void } = {},
): Promise<"present" | "built"> {
  const spawn = options.spawn ?? nodeSpawn;
  const image = options.image ?? RUNNER_IMAGE;
  const inspect = await collect(
    spawn(runtime, ["image", "inspect", image], { stdio: ["ignore", "pipe", "pipe"] }),
  );
  if (inspect.code === 0) return "present";
  options.log?.(`building the ${image} image with ${runtime}; this takes a few minutes once`);
  const build = spawn(runtime, ["build", "-t", image, "-"], { stdio: ["pipe", "pipe", "pipe"] });
  build.stdin?.end(RUNNER_DOCKERFILE);
  const built = await collect(build);
  if (built.code !== 0)
    throw new Error(
      `${runtime} build of ${image} failed with ${built.code}: ${built.output.trim()}`,
    );
  return "built";
}
