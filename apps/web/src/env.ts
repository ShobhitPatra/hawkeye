function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  betterAuthSecret: () => required("BETTER_AUTH_SECRET"),
  betterAuthUrl: () => required("BETTER_AUTH_URL"),
  githubClientId: () => required("GITHUB_CLIENT_ID"),
  githubClientSecret: () => required("GITHUB_CLIENT_SECRET"),
};
