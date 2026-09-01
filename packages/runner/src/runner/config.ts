import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type RunnerConfig = { controlPlaneUrl: string; token: string };

export async function loadRunnerConfig(input: {
  env: Record<string, string | undefined>;
  configPath: string;
  readFile(path: string): Promise<string>;
}): Promise<RunnerConfig> {
  const file = await input.readFile(input.configPath).then(
    (text) => JSON.parse(text) as Record<string, unknown>,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {} as Record<string, unknown>;
      throw new Error(`Cannot read runner config ${input.configPath}: ${error.message}`);
    },
  );
  const pick = (envName: string, fileName: keyof RunnerConfig): string => {
    const fromFile = file[fileName];
    if (fromFile !== undefined && typeof fromFile !== "string")
      throw new Error(`Invalid ${fileName} in ${input.configPath}: expected a string`);
    const value = input.env[envName] || fromFile;
    if (value === undefined || value === "")
      throw new Error(
        `Missing ${fileName}: run "hawkeye runner login --url <url>" or set ${envName}`,
      );
    return value;
  };
  return {
    controlPlaneUrl: pick("HAWKEYE_CONTROL_PLANE_URL", "controlPlaneUrl"),
    token: pick("HAWKEYE_RUNNER_TOKEN", "token"),
  };
}

export async function writeRunnerConfig(configPath: string, config: RunnerConfig): Promise<void> {
  const url = URL.parse(config.controlPlaneUrl);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
    throw new Error(`--url must be an http(s) URL, got "${config.controlPlaneUrl}"`);
  if (config.token === "") throw new Error("--token must not be empty");
  await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
}
