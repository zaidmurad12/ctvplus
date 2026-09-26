import { cachedSearch } from "./searchCache";

const CEE_BASE = "https://cee.buzz/api/android";

export interface CeeSearchItem {
  nb?: string | number;
  en_title?: string;
  ar_title?: string;
  year?: string | number;
  stars?: string | number;
  imdbUrlRef?: string;
  type?: string;
  kind?: string | number;
}

export interface CeeVideo {
  resolution?: string;
  videoUrl?: string;
  url?: string;
  name?: string;
}

export interface CeeInfo extends CeeSearchItem {
  en_content?: string;
  ar_content?: string;
  trailer?: string;
  translations?: Array<{ name?: string; file?: string; url?: string }>;
}

export interface CeeEpisode extends CeeSearchItem {
  season?: string | number;
  episodeNummer?: string | number;
  en_content?: string;
  ar_content?: string;
  imgObjUrl?: string;
  imgThumbObjUrl?: string;
  translations?: Array<{ name?: string; file?: string; url?: string }>;
}

// No request here used to have a timeout: a source that accepts the connection and then never answers
// (blocked/throttled network, overloaded server) left every caller waiting forever - the Watch button sat on
// "Preparing..." indefinitely. Bounded now so a dead source fails fast and the others still get their turn.
// Was 8000 - too tight in practice: this same request() also backs the *matching* searches
// (searchCee, up to 3 fired in parallel per title - see findCeeMatch), not just a single stream
// fetch, and those routinely needed more than 8s on a real, slower connection to this source.
// Missing that window silently returned "no match" (caught, not surfaced) for every title on
// such a connection - reported as "movies don't fetch playback links and the Watch button
// doesn't even show" for basically everything, not a specific title. 20s trades a slightly
// longer worst-case wait for actually finding the match that was really there.
const REQUEST_TIMEOUT_MS = 20000;
// A single dropped packet/DNS hiccup on a weak connection used to fail the whole request
// outright (timeout or a network error) with no second attempt - reported as titles flickering
// between working and not depending on nothing the viewer did differently, exactly what a flaky
// link (not a dead one) looks like. Two retries, a short growing pause between them, gives a
// connection that's merely weak (not actually down) a real chance to succeed on attempt 2 or 3
// instead of the whole match/playback lookup giving up on a single bad moment.
const REQUEST_RETRIES = 2;
const RETRY_DELAY_MS = 700;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function requestOnce<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CEE_BASE}${path}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`CEE API error ${response.status}`);
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

export function makeCeeId(id: string | number): string {
  return `cee:${String(id)}`;
}

export function rawCeeId(id: string): string {
  return id.replace(/^cee:/, "");
}

const searchCache = new Map<string, { at: number; value: Promise<CeeSearchItem[]> }>();

export function searchCee(query: string, type?: "movie" | "series"): Promise<CeeSearchItem[]> {
  return cachedSearch(searchCache, `${type ?? ""}|${query.trim().toLowerCase()}`, () => searchCeeUncached(query, type));
}

function searchCeeUncached(query: string, type?: "movie" | "series"): Promise<CeeSearchItem[]> {
  const params = new URLSearchParams({ videoTitle: query });
  if (type) params.set("type", type);
  return request<CeeSearchItem[] | { data?: CeeSearchItem[] }>(`/AdvancedSearch?${params.toString()}`).then((value) =>
    asArray(value).map((item) => (type ? { ...item, type } : item))
  );
}

export function fetchCeeInfo(id: string): Promise<CeeInfo> {
  return request<CeeInfo>(`/allVideoInfo/id/${encodeURIComponent(rawCeeId(id))}`);
}

export function fetchCeeVideos(id: string): Promise<CeeVideo[]> {
  return request<CeeVideo[] | { data?: CeeVideo[] }>(`/transcoddedFiles/id/${encodeURIComponent(rawCeeId(id))}`).then(asArray);
}

export function fetchCeeEpisodes(id: string): Promise<CeeEpisode[]> {
  return request<CeeEpisode[] | { data?: CeeEpisode[] }>(`/videoSeason/id/${encodeURIComponent(rawCeeId(id))}`).then(asArray);
}