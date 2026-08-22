const MARKER_PATTERN = /<!-- hawkeye: head=([0-9a-f]+) -->/;

export function encodeMarker(headSha: string): string {
  if (!/^[0-9a-f]+$/.test(headSha)) throw new Error(`Invalid head sha: "${headSha}"`);
  return `<!-- hawkeye: head=${headSha} -->`;
}

export function decodeMarker(body: string): string | undefined {
  return MARKER_PATTERN.exec(body)?.[1];
}
