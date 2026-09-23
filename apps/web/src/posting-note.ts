const PREFIX = "post: ";
const SHORT_FORM = /^GitHub refused the full review \((.*)\); the short form was posted$/s;

export type PostingNote = { kind: "short-form" | "not-posted"; detail: string };

export function shortFormNote(reason: string): string {
  return `${PREFIX}GitHub refused the full review (${reason}); the short form was posted`;
}

export function failedPostNote(reason: string): string {
  return `${PREFIX}${reason}`;
}

export function postingNote(error: string | undefined): PostingNote | undefined {
  if (!error?.startsWith(PREFIX)) return undefined;
  const detail = error.slice(PREFIX.length);
  const shortForm = SHORT_FORM.exec(detail);
  return shortForm ? { kind: "short-form", detail: shortForm[1]! } : { kind: "not-posted", detail };
}
