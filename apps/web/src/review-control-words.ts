export type ReviewControlWords = { word: string; next: string; pending: boolean };

export function reviewControlWords(input: {
  reviewing: boolean;
  pending: boolean;
}): ReviewControlWords {
  if (input.pending)
    return { word: input.reviewing ? "Starting" : "Pausing", next: "", pending: true };
  return input.reviewing
    ? { word: "Reviewing", next: "Pause", pending: false }
    : { word: "Review", next: "Review", pending: false };
}
