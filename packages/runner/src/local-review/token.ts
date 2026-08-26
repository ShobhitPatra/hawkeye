export type Exec = (
  command: string,
  args: string[],
) => Promise<{ exitCode: number | null; stdout: string }>;

export const NO_GITHUB_TOKEN =
  "no GitHub token: pass --github-token, set GITHUB_TOKEN, or sign in with gh";

export async function resolveGitHubToken(input: {
  option?: string;
  env: Record<string, string | undefined>;
  exec: Exec;
}): Promise<string> {
  if (input.option !== undefined && input.option !== "") return input.option;
  const fromEnv = input.env.GITHUB_TOKEN;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const result = await input.exec("gh", ["auth", "token"]).catch(() => undefined);
  const token = result?.stdout.trim() ?? "";
  if (result === undefined || result.exitCode !== 0 || token === "")
    throw new Error(NO_GITHUB_TOKEN);
  return token;
}
