const MARKER_PATTERN = /<!-- hawkeye: head=([0-9a-f]+) -->/;

export function encodeMarker(headSha: string): string {
  if (!/^[0-9a-f]+$/.test(headSha)) throw new Error(`Invalid head sha: "${headSha}"`);
  return `<!-- hawkeye: head=${headSha} -->`;
}

export function decodeMarker(body: string): string | undefined {
  return MARKER_PATTERN.exec(body)?.[1];
}

const FINDING_MARKER_PATTERN = /<!-- hawkeye: finding=([0-9a-f]+) -->/;

export function encodeFindingMarker(stableId: string): string {
  if (!/^[0-9a-f]+$/.test(stableId)) throw new Error(`Invalid finding id: "${stableId}"`);
  return `<!-- hawkeye: finding=${stableId} -->`;
}

export function decodeFindingMarker(body: string): string | undefined {
  return FINDING_MARKER_PATTERN.exec(body)?.[1];
}
