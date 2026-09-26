import { cachedSearch } from "./searchCache";

const CINEMANA_BASE = "https://cinemana.shabakaty.com/api/android";

export interface CinemanaSearchItem {
  nb?: string | number;
  en_title?: string;
  ar_title?: string;
  imdbUrlRef?: string;
  year?: string | number;
  stars?: string | number;
  imgThumbObjUrl?: string;
  imgObjUrl?: string;
  type?: string;
  kind?: string | number;
}

export interface CinemanaInfo extends CinemanaSearchItem {
  en_content?: string;
  ar_content?: string;
  trailer?: string;
  translations?: Array<{ name?: string; file?: string; url?: string }>;
}

export interface CinemanaVideo {
  resolution?: string;
  videoUrl?: string;
  url?: string;
  name?: string;
}

export interface CinemanaEpisode {
  season?: string | number;
  episodeNummer?: string | number;
  nb?: string | number;
  en_title?: string;
  ar_title?: string;
  en_content?: string;
  ar_content?: string;
  year?: string | number;
  imgObjUrl?: string;
  imgThumbObjUrl?: string;
  translations?: Array<{ name?: string; file?: string; url?: string }>;
}

// No request here used to have a timeout: a source that accepts the connection and then never answers
// (blocked/throttled network, overloaded server) left every caller waiting forever - the Watch button sat on
// "Preparing..." indefinitely. Bounded now so a dead source fails fast and the others still get their turn.
// See cee.ts's own identical constant for why this is 20s, not the original 8s - same reasoning,
// same fix, applies equally to this source's own matching searches.
const REQUEST_TIMEOUT_MS = 20000;
// See cee.ts's own identical retry logic for the full reasoning - a flaky (not dead) connection
// used to fail the whole request on one bad moment with no second attempt.
const REQUEST_RETRIES = 2;
const RETRY_DELAY_MS = 700;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function requestOnce<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CINEMANA_BASE}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Cinemana API error ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
async function request<T>(path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    try {
      return await requestOnce<T>(path);
    } catch (err) {
      lastError = err;
      if (attempt < REQUEST_RETRIES) await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

function asArray<T>(value: T[] | { data?: T[] } | null | undefined): T[] {
  return Array.isArray(value) ? value : value?.data ?? [];
}

export function makeCinemanaId(id: string | number): string {
  return `cinemana:${String(id)}`;
}

export function isCinemanaId(id: string): boolean {
  return id.startsWith("cinemana:");
}

export function rawCinemanaId(id: string): string {
  return id.replace(/^cinemana:/, "");
}

const searchCache = new Map<string, { at: number; value: Promise<CinemanaSearchItem[]> }>();

export function searchCinemana(query: string, type?: "movie" | "series"): Promise<CinemanaSearchItem[]> {
  return cachedSearch(searchCache, `${type ?? ""}|${query.trim().toLowerCase()}`, () => searchCinemanaUncached(query, type));
}

function searchCinemanaUncached(query: string, type?: "movie" | "series"): Promise<CinemanaSearchItem[]> {
  const params = new URLSearchParams({ videoTitle: query });
  if (type) params.set("type", type === "series" ? "series" : "movie");
  return request<CinemanaSearchItem[] | { data?: CinemanaSearchItem[] }>(`/AdvancedSearch?${params.toString()}`).then((value) =>
    asArray(value).map((item) => (type ? { ...item, type } : item))
  );
}

export function fetchCinemanaInfo(id: string): Promise<CinemanaInfo> {
  return request<CinemanaInfo>(`/allVideoInfo/id/${encodeURIComponent(rawCinemanaId(id))}`);
}

export function fetchCinemanaVideos(id: string): Promise<CinemanaVideo[]> {
  return request<CinemanaVideo[] | { data?: CinemanaVideo[] }>(`/transcoddedFiles/id/${encodeURIComponent(rawCinemanaId(id))}`).then(asArray);
}

export function fetchCinemanaEpisodes(id: string): Promise<CinemanaEpisode[]> {
  return request<CinemanaEpisode[] | { data?: CinemanaEpisode[] }>(`/videoSeason/id/${encodeURIComponent(rawCinemanaId(id))}`).then(asArray);
}

export function fetchCinemanaEpisodeVideos(id: string): Promise<CinemanaVideo[]> {
  return fetchCinemanaVideos(id);
}
