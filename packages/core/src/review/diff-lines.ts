const FILE_HEADER = /^\+\+\+ b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function commentableLines(unifiedDiff: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  let line = 0;
  for (const raw of unifiedDiff.split("\n")) {
    const file = FILE_HEADER.exec(raw);
    if (file) {
      current = new Set();
      result.set(file[1]!, current);
      continue;
    }
    if (raw.startsWith("+++ /dev/null")) {
      current = undefined;
      continue;
    }
    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+") || raw.startsWith(" ")) {
      current.add(line);
      line += 1;
    }
  }
  return result;
}
