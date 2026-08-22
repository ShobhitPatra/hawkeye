export type HawkeyeConfig = { appId: string; appSlug: string; privateKeyPath: string };

export async function loadConfig(input: {
  env: Record<string, string | undefined>;
  configPath: string;
  readFile(path: string): Promise<string>;
}): Promise<HawkeyeConfig> {
  const file = await input.readFile(input.configPath).then(
    (text) => JSON.parse(text) as Record<string, unknown>,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {} as Record<string, unknown>;
      throw new Error(`Cannot read config ${input.configPath}: ${error.message}`);
    },
  );
  const pick = (envName: string, fileName: keyof HawkeyeConfig): string => {
    const value =
      input.env[envName] ?? (file[fileName] === undefined ? undefined : String(file[fileName]));
    if (value === undefined || value === "")
      throw new Error(
        `Missing ${fileName}: set ${envName} or "${fileName}" in ${input.configPath}`,
      );
    return value;
  };
  return {
    appId: pick("HAWKEYE_APP_ID", "appId"),
    appSlug: pick("HAWKEYE_APP_SLUG", "appSlug"),
    privateKeyPath: pick("HAWKEYE_APP_PRIVATE_KEY_PATH", "privateKeyPath"),
  };
}
