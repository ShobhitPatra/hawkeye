export function localPath(value: string | undefined): string | undefined {
  return value !== undefined && /^\/(?![/\\])/.test(value) ? value : undefined;
}
