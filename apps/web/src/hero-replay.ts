export const HERO_ACTS = {
  machine: 1200,
  reviewing: 3600,
  posted: 5400,
} as const;

export const STREAM_TICK_MS = 14;
export const STREAM_CHUNK_CHARS = 28;

export function chunkEnds(length: number, chunk: number = STREAM_CHUNK_CHARS): number[] {
  if (!Number.isInteger(chunk) || chunk < 1) throw new Error("chunk must be a positive integer");
  const count = Math.max(1, Math.ceil(length / chunk));
  return Array.from({ length: count }, (_, index) => Math.ceil((length * (index + 1)) / count));
}
