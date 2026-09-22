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
const REQUEST_TIMEOUT_MS = 8000;
async function request<T>(path: string): Promise<T> {
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

function asArray<T>(value: T[] | { data?: T[] } | null | undefined): T[] {
  return Array.isArray(value) ? value : value?.data ?? [];
}

export function makeCeeId(id: string | number): string {
  return `cee:${String(id)}`;
}

export function isCeeId(id: string): boolean {
  return id.startsWith("cee:");
}

export function rawCeeId(id: string): string {
  return id.replace(/^cee:/, "");
}

export function searchCee(query: string, type?: "movie" | "series"): Promise<CeeSearchItem[]> {
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