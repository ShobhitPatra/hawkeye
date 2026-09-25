export const HERO_ACTS = {
  chip: 700,
  machine: 2000,
  reviewing: 5200,
  posted: 6400,
} as const;

export const STREAM_TICK_MS = 16;
export const STREAM_CHUNK_CHARS = 20;
export const STREAM_LEAD_BLOCKS = 2;
export const STREAM_LEAD_TICK_MS = 20;
export const STREAM_LEAD_CHUNK_CHARS = 6;
export const STREAM_SETTLE_MS = 800;
export const REPLAY_VISIBLE_RATIO = 0.5;

export function chunkEnds(length: number, chunk: number = STREAM_CHUNK_CHARS): number[] {
  if (!Number.isInteger(chunk) || chunk < 1) throw new Error("chunk must be a positive integer");
  const count = Math.max(1, Math.ceil(length / chunk));
  return Array.from({ length: count }, (_, index) => Math.ceil((length * (index + 1)) / count));
}
