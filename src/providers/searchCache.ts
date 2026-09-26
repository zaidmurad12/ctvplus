// Source searches are repeated a lot within a few seconds of each other: opening a title matches it
// against both sources (findCinemanaMatch/findCeeMatch), then looks for its language versions
// (findSourceVersions) with largely the same queries, and the Watch press can match again. Caching
// the in-flight promise for a short while answers every repeat - even one made at the same moment -
// from the first request. Failed requests aren't kept.
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 150;

export function cachedSearch<T>(cache: Map<string, { at: number; value: Promise<T> }>, key: string, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = run();
  value.catch(() => cache.delete(key));
  cache.delete(key);
  cache.set(key, { at: now, value });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}
