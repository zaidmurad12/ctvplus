import { API_BASE } from "./api";
import { fetchCinemanaLatest, type CinemanaLatestItem } from "./providers/cinemana";
import { loadJson, saveJson, storageKeys } from "./storage";

// Every few hours, from the viewer's own TV (inside Iraq - the only place the sources answer), the
// sources' "newly added" films and series are sent to our server, which marks the ones we already
// have as playable and imports the missing ones (see the backend's admin/sourceLatest.ts). Runs
// well after startup and is entirely in the background - nothing on screen waits for it.
const SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
// The server confirms which titles it has handled; those are remembered (newest first, bounded) and
// not sent again, so each sync carries only what the sources added since the last one.
const REMEMBER_MAX = 600;

function toItem(item: CinemanaLatestItem, kind: "movie" | "series") {
  if (item.nb == null) return null;
  return {
    nb: String(item.nb),
    kind,
    enTitle: item.en_title?.trim() || undefined,
    arTitle: item.ar_title?.trim() || undefined,
    year: item.year != null ? String(item.year) : undefined,
    ref: item.imdbUrlRef?.trim() || undefined,
  };
}

export async function syncLatestFromSources(): Promise<void> {
  const last = await loadJson<number>(storageKeys.latestSyncAt, 0);
  if (Date.now() - last < SYNC_INTERVAL_MS) return;
  const synced = new Set(await loadJson<string[]>(storageKeys.latestSyncedNb, []));
  const [movies, series] = await Promise.all([
    fetchCinemanaLatest("movie").catch(() => [] as CinemanaLatestItem[]),
    fetchCinemanaLatest("series").catch(() => [] as CinemanaLatestItem[]),
  ]);
  const items = [...movies.map((m) => toItem(m, "movie")), ...series.map((s) => toItem(s, "series"))].filter(
    (x): x is NonNullable<typeof x> => !!x && !synced.has(x.nb)
  );
  if (!items.length) {
    // Nothing new since the last sync is fine; both lists failing to load is retried next hour.
    if (movies.length || series.length) saveJson(storageKeys.latestSyncAt, Date.now());
    return;
  }
  const res = await fetch(`${API_BASE}/sources/latest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.slice(0, 60) }),
  });
  if (!res.ok) return;
  saveJson(storageKeys.latestSyncAt, Date.now());
  const body = (await res.json().catch(() => null)) as { done?: unknown } | null;
  const done = Array.isArray(body?.done) ? body.done.filter((x): x is string => typeof x === "string") : [];
  if (done.length) saveJson(storageKeys.latestSyncedNb, [...done, ...synced].slice(0, REMEMBER_MAX));
}
