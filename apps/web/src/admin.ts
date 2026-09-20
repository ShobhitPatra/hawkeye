export function adminLogins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter((login) => login !== ""),
  );
}

export function isAdmin(login: string | null | undefined, value: string | undefined): boolean {
  if (!login) return false;
  return adminLogins(value).has(login.toLowerCase());
}
