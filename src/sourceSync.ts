import { API_BASE } from "./api";
import { fetchCinemanaLatest, type CinemanaLatestItem } from "./providers/cinemana";
import { loadJson, saveJson, storageKeys } from "./storage";

// Once a day, from the viewer's own TV (inside Iraq - the only place the sources answer), the
// sources' "newly added" films and series are sent to our server, which marks the ones we already
// have as playable and imports the missing ones (see the backend's admin/sourceLatest.ts). Runs
// well after startup and is entirely in the background - nothing on screen waits for it.
const DAY_MS = 24 * 60 * 60 * 1000;

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
  if (Date.now() - last < DAY_MS) return;
  const [movies, series] = await Promise.all([
    fetchCinemanaLatest("movie").catch(() => [] as CinemanaLatestItem[]),
    fetchCinemanaLatest("series").catch(() => [] as CinemanaLatestItem[]),
  ]);
  const items = [...movies.map((m) => toItem(m, "movie")), ...series.map((s) => toItem(s, "series"))].filter(
    (x): x is NonNullable<typeof x> => !!x
  );
  if (!items.length) return;
  const res = await fetch(`${API_BASE}/sources/latest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: items.slice(0, 60) }),
  });
  if (res.ok) saveJson(storageKeys.latestSyncAt, Date.now());
}
