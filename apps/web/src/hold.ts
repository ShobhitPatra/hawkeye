export type Held<T> = { at: number; ttl: number; value: Promise<T> };
export type HoldStore<T> = Map<string, Held<T>>;

export function hold<T>(
  store: HoldStore<T>,
  key: string,
  input: { now: number; ttlMs: number; ttlAfter?: (value: T) => number },
  produce: () => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) throw new Error("ttlMs must be positive");
  const held = store.get(key);
  if (held && input.now - held.at < held.ttl) return held.value;
  for (const [otherKey, other] of store)
    if (input.now - other.at >= other.ttl) store.delete(otherKey);
  const entry: Held<T> = { at: input.now, ttl: input.ttlMs, value: produce() };
  store.set(key, entry);
  entry.value.then(
    (value) => {
      if (input.ttlAfter) entry.ttl = input.ttlAfter(value);
    },
    () => {
      if (store.get(key) === entry) store.delete(key);
    },
  );
  return entry.value;
}
