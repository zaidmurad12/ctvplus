// Official TMDB v3 REST API client — replaces the HTML-scraping approach previously used
// throughout server.ts (regex-parsing www.themoviedb.org marketing pages). Centralizes
// auth, the base URL, and request pacing in one place, mirroring db.ts's shape for the
// SQLite layer. Every exported function returns already-shaped data, never a raw
// fetch Response — callers in server.ts never see a TMDB image *path* (TMDB returns bare
// paths like "/abc123.jpg", not full URLs) without going through one of the *Url() helpers.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not configured in .env");
  return key;
}

// --- Request pacing + 429 cooldown --------------------------------------------------
// The healing cycle (healAndSyncDatabase) can trigger metadata lookups for hundreds of
// movies in one pass — without spacing, that's a burst of concurrent requests against a
// real, rate-limited API (unlike scraping a marketing site, TMDB actually enforces this).
// A single serialized queue with a minimum gap between requests, plus a cooldown flag on
// 429 (mirroring handleGeminiError's quotaExceededUntil pattern in server.ts), keeps this
// well-behaved without needing per-call-site throttling logic.

let tmdbQuotaExceededUntil = 0;
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
const MIN_GAP_MS = 120;

async function throttledFetch(url: string): Promise<Response> {
  if (Date.now() < tmdbQuotaExceededUntil) {
    throw new Error("TMDB rate limit cooldown active");
  }

  const gate = requestChain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  requestChain = gate.catch(() => {}); // keep the chain alive even if this request errors
  await gate;

  // The very first HTTPS request in a fresh process can take noticeably longer than
  // subsequent ones (cold DNS resolution/TLS handshake, no warm connection pool yet) —
  // a generous timeout avoids spurious failures on that first call specifically. A
  // transient connect-level failure (observed in testing: an occasional individual CDN
  // edge IP briefly unreachable, self-resolving on retry) gets one quick retry before
  // giving up and letting the caller's own fallback chain (Wikipedia/Gemini/Unsplash,
  // for image lookups) take over.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 10;
        tmdbQuotaExceededUntil = Date.now() + retryAfter * 1000;
        console.warn(`[TMDB] 429 rate limited — cooling down for ${retryAfter}s.`);
      }
      return res;
    } catch (err) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable"); // satisfies TS control-flow analysis; loop always returns or throws above
}

function tmdbUrl(path: string, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ api_key: apiKey(), ...params }).toString();
  return `${TMDB_BASE}${path}?${qs}`;
}

async function tmdbGet<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  try {
    const res = await throttledFetch(tmdbUrl(path, params));
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[TMDB] ${path} responded ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[TMDB] Request failed for ${path}:`, err);
    return null;
  }
}

// --- Image URL builders -----------------------------------------------------------
// Sizes chosen to match what the existing frontend upgrader (src/utils/imageUtils.ts's
// getHighResImage) already treats as a "fully upgraded, don't touch further" terminal
// size for each image kind — so nothing downstream of these needs to change.

export function tmdbImageUrl(path: string | null | undefined, size: string): string | null {
  if (!path) return null;
  return `${TMDB_IMG_BASE}/${size}${path.startsWith("/") ? path : "/" + path}`;
}

export const posterUrl = (path?: string | null) => tmdbImageUrl(path, "w780");
export const backdropUrl = (path?: string | null) => tmdbImageUrl(path, "original");
export const profileUrl = (path?: string | null) => tmdbImageUrl(path, "w185");
export const logoUrl = (path?: string | null) => tmdbImageUrl(path, "w500");

// --- Search --------------------------------------------------------------------------

export interface TmdbSearchHit {
  id: number;
  mediaType: "movie" | "tv";
}

export async function searchMulti(query: string): Promise<TmdbSearchHit | null> {
  const data = await tmdbGet<{ results: any[] }>("/search/multi", { query, include_adult: "false" });
  const hit = data?.results?.find(r => r.media_type === "movie" || r.media_type === "tv");
  if (!hit) return null;
  return { id: hit.id, mediaType: hit.media_type };
}

export async function searchPerson(name: string): Promise<{ id: number; profilePath: string | null } | null> {
  const data = await tmdbGet<{ results: any[] }>("/search/person", { query: name });
  const hit = data?.results?.[0];
  if (!hit) return null;
  return { id: hit.id, profilePath: hit.profile_path ?? null };
}

// --- Movie / TV details ---------------------------------------------------------------
// One call each, with append_to_response pulling in credits/images/translations/release
// info that the old scraper needed 2-3 separate page fetches to assemble.

const MOVIE_APPEND = "credits,images,videos,translations,release_dates";
const TV_APPEND = "credits,images,videos,translations,content_ratings,external_ids";
const IMAGE_LANGS = "en,ar,null";

export async function getMovieDetails(id: number | string): Promise<any | null> {
  return tmdbGet<any>(`/movie/${id}`, {
    language: "en-US",
    append_to_response: MOVIE_APPEND,
    include_image_language: IMAGE_LANGS,
  });
}

export async function getMovieArabic(id: number | string): Promise<{ title?: string; overview?: string } | null> {
  return tmdbGet<any>(`/movie/${id}`, { language: "ar" });
}

export async function getTvDetails(id: number | string): Promise<any | null> {
  return tmdbGet<any>(`/tv/${id}`, {
    language: "en-US",
    append_to_response: TV_APPEND,
    include_image_language: IMAGE_LANGS,
  });
}

export async function getTvArabic(id: number | string): Promise<{ name?: string; overview?: string } | null> {
  return tmdbGet<any>(`/tv/${id}`, { language: "ar" });
}

export async function getTvSeasonDetails(tvId: number | string, seasonNumber: number, language: string = "en-US"): Promise<any | null> {
  return tmdbGet<any>(`/tv/${tvId}/season/${seasonNumber}`, { language });
}

// --- Collections ------------------------------------------------------------------

export async function getCollectionDetails(collectionId: number | string, language: string = "en-US"): Promise<any | null> {
  return tmdbGet<any>(`/collection/${collectionId}`, { language });
}

// --- Trending / discovery (replaces fetchRealTMDBTrendingPaths's HTML scraping) --------
// Real ids straight from JSON — no regex needed at all, unlike the old page-scrape.

const TRENDING_ENDPOINTS: { path: string; mediaType: "movie" | "tv" }[] = [
  { path: "/trending/movie/week", mediaType: "movie" },
  { path: "/trending/tv/week", mediaType: "tv" },
  { path: "/movie/top_rated", mediaType: "movie" },
  { path: "/movie/now_playing", mediaType: "movie" },
  { path: "/movie/upcoming", mediaType: "movie" },
  { path: "/tv/top_rated", mediaType: "tv" },
  { path: "/tv/on_the_air", mediaType: "tv" },
  { path: "/tv/popular", mediaType: "tv" },
];

export async function getTrendingPaths(): Promise<string[]> {
  const paths = new Set<string>();
  for (const endpoint of TRENDING_ENDPOINTS) {
    const data = await tmdbGet<{ results: any[] }>(endpoint.path);
    for (const item of data?.results ?? []) {
      if (item?.id) paths.add(`/${endpoint.mediaType}/${item.id}`);
    }
  }
  return Array.from(paths);
}
