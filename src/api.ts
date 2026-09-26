// Talks to the independent CTV-Platform backend (NestJS + Postgres, its own database - see
// D:\CTV-Platform), fully separate from the old app's infrastructure. Shows/seasons/episodes
// are now public there too (ShowsController/SeasonsController/EpisodesController all carry
// @Public()), and admin-entered streams/subtitles are real, admin-managed links (no seed/demo
// data left in the database) - so both movies and shows read their real `streams` straight
// through into `servers` below instead of forcing it empty.
import {
  fetchCinemanaEpisodeVideos,
  fetchCinemanaEpisodes,
  fetchCinemanaInfo,
  fetchCinemanaVideos,
  isCinemanaId,
  makeCinemanaId,
  searchCinemana,
  type CinemanaEpisode,
  type CinemanaInfo,
  type CinemanaSearchItem,
} from "./providers/cinemana";
import { searchCee, makeCeeId, fetchCeeEpisodes, fetchCeeInfo, fetchCeeVideos, type CeeSearchItem } from "./providers/cee";
import { qualityRank, qualityLabel } from "./quality";

const NEW_API_BASE = "https://ctv-platform-backend-afcem6ospa-ww.a.run.app/api/v1";
export const API_BASE = NEW_API_BASE;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { page?: number; limit?: number; total?: number; hasMore?: boolean; [k: string]: unknown };
  error?: { code: string; message: string };
}

async function apiGet<T>(path: string): Promise<ApiEnvelope<T>> {
  const res = await fetch(`${NEW_API_BASE}${path}`);
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !body.success) throw new Error(body.error?.message || `API error ${res.status}`);
  return body;
}

// --- New-backend DTO shapes (see D:\CTV-Platform\apps\backend\src\catalog\dto.ts) ------------

interface ArtworkDto {
  poster?: string;
  backdrop?: string;
  logo?: string;
}

interface MovieSummaryDto {
  id: string;
  title: string;
  titleAr?: string | null;
  overview?: string | null;
  overviewAr?: string | null;
  // Now sent on every summary/detail response, not just search results - see
  // calculateMatchScore's own comment on why every entry point needs this, not just Search.
  imdbId?: string | null;
  releaseDate?: string | null;
  rating?: number | null;
  runtime?: number | null;
  ageRating?: string | null;
  originalLanguage?: string | null;
  genres: string[];
  hasPlayableStream: boolean;
  collectionId?: string | null;
  // Derived server-side from this movie's position (by releaseDate) among its collection's other
  // PUBLISHED entries - see MovieQueryRepository.attachPartNumbers on the backend. Null when
  // collectionId itself is null (not part of any franchise).
  partNumber?: number | null;
  artwork: ArtworkDto;
}

interface CastMemberDto {
  id: string;
  name: string;
  character?: string | null;
  photo?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  biography?: string | null;
  biographyAr?: string | null;
  placeOfBirth?: string | null;
}

interface StreamDto {
  id: string;
  quality: string;
  serverName: string;
  streamUrl: string;
  language?: string | null;
  isDefault: boolean;
}

interface SubtitleDto {
  id: string;
  language: string;
  format: string;
  url: string;
  isDefault: boolean;
  // The manual offset/speed correction - the only sync mechanism this app has (the automatic
  // multi-point audio-analysis system this replaced was removed entirely as dead code - nothing
  // ever populated it after the analysis service and the on-device auto-sync button that would
  // have triggered it were both already gone). Seeds subtitleOffsetMs/subtitleSpeed in
  // VideoPlayer.tsx unless the viewer has saved their own local override for this exact title.
  defaultOffsetMs: number;
  defaultSpeed: number;
}

interface MovieDetailDto extends MovieSummaryDto {
  sourceLinks?: SourceLink[];
  cast: CastMemberDto[];
  director?: CastMemberDto | null;
  writer?: CastMemberDto | null;
  country?: string | null;
  streams: StreamDto[];
  subtitles: SubtitleDto[];
  trailerUrl?: string | null;
  // TMDB original_title - for an Arabic-language movie this is its Arabic name (see
  // calculateMatchScore), even when titleAr is empty.
  originalTitle?: string | null;
}

interface SearchResultItemDto {
  id: string;
  type: "movie" | "show";
  title: string;
  titleAr?: string | null;
  poster?: string | null;
  // Free to return (the query already fetches the full row) - lets a search result card show a
  // rating/year the same way every other card in the app does.
  rating?: number | null;
  releaseDate?: string | null;
  // Movies only - shows never have a collectionId to derive this from (see partNumbers.ts on
  // the backend).
  partNumber?: number | null;
  originalTitle?: string | null;
  imdbId?: string | null;
  imdbUrlRef?: string | null;
}

// --- Shows/seasons/episodes DTOs (see D:\CTV-Platform\apps\backend\src\catalog\dto.ts) --------

interface ShowSummaryDto {
  id: string;
  title: string;
  titleAr?: string | null;
  overview?: string | null;
  overviewAr?: string | null;
  imdbId?: string | null;
  releaseDate?: string | null;
  rating?: number | null;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  ageRating?: string | null;
  originalLanguage?: string | null;
  genres: string[];
  artwork: ArtworkDto;
}

// The home hero carousel (/movies/featured) can mix movies and shows in one admin-ordered
// sequence - `type` says which shape a given item actually is.
type FeaturedItemDto = (MovieSummaryDto & { type: "movie" }) | (ShowSummaryDto & { type: "show" });

interface SeasonSummaryDto {
  id: string;
  seasonNumber: number;
  name?: string | null;
  episodeCount: number;
  poster?: string | null;
  airDate?: string | null;
}

interface ShowDetailDto extends ShowSummaryDto {
  sourceLinks?: SourceLink[];
  cast: CastMemberDto[];
  director?: CastMemberDto | null;
  writer?: CastMemberDto | null;
  // TMDB has no show-level director/writer credit for almost any real series - director/writer
  // above are effectively always null for a show. `created_by` is the actual populated
  // show-level credit, imported separately as this 'Creator' role (see creditsMapper.ts).
  creator?: CastMemberDto | null;
  country?: string | null;
  seasons: SeasonSummaryDto[];
  originalTitle?: string | null;
}

interface PersonCreditDto {
  id: string;
  type: "movie" | "show";
  title: string;
  poster?: string | null;
  rating?: number | null;
  releaseDate?: string | null;
}

interface PersonDetailDto {
  id: string;
  name: string;
  photo?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  biography?: string | null;
  biographyAr?: string | null;
  filmography: PersonCreditDto[];
}

interface EpisodeSummaryDto {
  id: string;
  episodeNumber: number;
  title: string;
  titleAr?: string | null;
  overview?: string | null;
  overviewAr?: string | null;
  runtime?: number | null;
  stillImage?: string | null;
  airDate?: string | null;
  hasPlayableStream: boolean;
}

interface SeasonDetailDto extends SeasonSummaryDto {
  overview?: string | null;
  episodes: EpisodeSummaryDto[];
}

function formatRuntime(minutes?: number | null): string | undefined {
  if (!minutes) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function cinemanaNumber(value?: string | number): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// An admin-pinned source entry for a title (Movie.sourceLinks on the backend) - "kind" is what the SOURCE
// files it under, which can differ from what we call it: a stage play is a movie here but many sources
// list it in their series section.
export interface SourceLink {
  source: "cee" | "cinemana";
  nb: string;
  kind: "movie" | "series";
}

export interface PlaybackMapping {
  provider: "cinemana" | "cee";
  cinemanaId?: string;
  ceeId?: string;
  available: boolean;
  // Set for an admin-pinned link whose source entry is a series (see SourceLink) - playback then has to
  // go through that entry's first episode instead of the entry itself.
  kind?: "movie" | "series";
}

const CINEMANA_MATCH_THRESHOLD = 85;
// Capped, not just a plain Map - this app is expected to stay resident in the process for hours/
// days at a time (see App.tsx's own comments on why), and every distinct movie/show viewed in a
// session used to add an entry here that nothing ever removed - slow, unbounded memory growth
// over a long-running session rather than at launch. FIFO eviction (oldest inserted key first,
// via Map's own insertion-order iteration) once over the cap is simple and good enough here; this
// is a short-lived per-session cache, not something that needs true LRU recency tracking.
const CINEMANA_MATCH_CACHE_MAX = 500;
const cinemanaMatchCache = new Map<string, PlaybackMapping>();
function cacheMatch(key: string, value: PlaybackMapping): void {
  if (cinemanaMatchCache.size >= CINEMANA_MATCH_CACHE_MAX) {
    const oldestKey = cinemanaMatchCache.keys().next().value;
    if (oldestKey !== undefined) cinemanaMatchCache.delete(oldestKey);
  }
  cinemanaMatchCache.set(key, value);
}

export function normalizeTitle(value?: string | null): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    // Arabic-Indic (٠-٩) and Persian (۰-۹) digits as plain 0-9 - TMDB's "6 شهور" and a source's
    // "٦ شهور" are the same title.
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function extractImdbId(value?: string | null): string | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:imdb\.com\/title\/)?(tt\d{7,10})/i);
  return match?.[1]?.toLowerCase();
}

function titleSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = previous[j];
      previous[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + 1);
      diagonal = saved;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

export function calculateMatchScore(tmdbMovie: Movie, cinemanaItem: CinemanaSearchItem): number {
  const tmdbType = tmdbMovie.type === "series" ? "series" : "movie";
  const cinemanaType = String(cinemanaItem.type ?? (String(cinemanaItem.kind) === "2" ? "series" : "movie")).toLowerCase().includes("series") ? "series" : "movie";
  if (tmdbType !== cinemanaType) return 0;

  const tmdbImdb = extractImdbId(tmdbMovie.imdbId);
  const cinemanaImdb = extractImdbId(cinemanaItem.imdbUrlRef);
  if (tmdbImdb && cinemanaImdb && tmdbImdb === cinemanaImdb) return 100;

  const tmdbEnglish = normalizeTitle(tmdbMovie.titleEn);
  const tmdbOriginalEnglish = normalizeTitle(tmdbMovie.originalTitle);
  const tmdbArabic = normalizeTitle(tmdbMovie.titleAr);
  const cinemanaEnglish = normalizeTitle(cinemanaItem.en_title);
  const cinemanaArabic = normalizeTitle(cinemanaItem.ar_title);
  const englishExact = (!!tmdbEnglish && tmdbEnglish === cinemanaEnglish) || (!!tmdbOriginalEnglish && tmdbOriginalEnglish === cinemanaEnglish);
  // An Arabic-language work's TMDB *original* title is its Arabic name, and TMDB never lists a
  // separate Arabic translation for it - so titleAr is often empty for exactly these works, which
  // left them matching only on a transliterated English name no source uses. Sources also often
  // put the Arabic name in en_title too.
  const tmdbArabicOriginal = /[؀-ۿ]/.test(tmdbMovie.originalTitle ?? "") ? tmdbOriginalEnglish : "";
  const arabicExact = [tmdbArabic, tmdbArabicOriginal].some((title) => !!title && (title === cinemanaArabic || title === cinemanaEnglish));
  const fuzzy = Math.max(
    titleSimilarity(tmdbEnglish, cinemanaEnglish),
    titleSimilarity(tmdbOriginalEnglish, cinemanaEnglish),
    titleSimilarity(tmdbEnglish, cinemanaArabic),
    titleSimilarity(tmdbOriginalEnglish, cinemanaArabic),
    titleSimilarity(tmdbArabic, cinemanaEnglish),
    titleSimilarity(tmdbArabic, cinemanaArabic),
  );
  const tmdbYear = tmdbMovie.year;
  const cinemanaYear = cinemanaNumber(cinemanaItem.year);
  if (tmdbYear && cinemanaYear && Math.abs(tmdbYear - cinemanaYear) > 1) return 0;
  const yearScore = tmdbYear && cinemanaYear ? (tmdbYear === cinemanaYear ? 20 : Math.abs(tmdbYear - cinemanaYear) === 1 ? 8 : 0) : 0;
  return Math.min(100, 15 + (englishExact ? 45 : 0) + (arabicExact ? 35 : 0) + Math.round(fuzzy * 25) + yearScore);
}

export function matchTmdbWithCinemana(tmdbMovie: Movie, candidates: CinemanaSearchItem[]): CinemanaSearchItem | null {
  let best: CinemanaSearchItem | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = calculateMatchScore(tmdbMovie, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= CINEMANA_MATCH_THRESHOLD ? best : null;
}

export async function findCinemanaMatch(movie: Movie): Promise<PlaybackMapping | null> {
  const linked = movie.sourceLinks?.find((link) => link.source === "cinemana");
  if (linked) return { provider: "cinemana", cinemanaId: makeCinemanaId(linked.nb), kind: linked.kind, available: true };
  const cached = cinemanaMatchCache.get(movie.id);
  if (cached) return cached;
  const type = movie.type === "series" ? "series" : "movie";
  try {
    const queries = [...new Set([movie.titleEn, movie.originalTitle, movie.titleAr].filter((title): title is string => !!title?.trim()))];
    const candidateGroups = await Promise.all(queries.map((query) => searchCinemana(query, type)));
    const match = matchTmdbWithCinemana(movie, candidateGroups.flat());
    if (!match || match.nb == null) return null;
    const playback: PlaybackMapping = { provider: "cinemana", cinemanaId: makeCinemanaId(match.nb), available: true };
    cacheMatch(movie.id, playback);
    return playback;
  } catch {
    return null;
  }
}

// --- Language versions (e.g. an anime both subtitled and Arabic-dubbed) --------------------------

// One work can exist on the sources as several entries - the original with subtitles, and an
// Arabic dub filed under its Arabic title - which matching alone silently picks between (reported:
// One Piece from Home played subtitled, the same show found through an Arabic search played dubbed).
// Entries that are versions of the same work share its external reference (IMDb, MyAnimeList,
// elCinema) - that, not the title, is what groups them here.
export interface SourceVersion {
  key: string;
  dubbed: boolean;
  title: string;
  sources: PlaybackMapping[];
}

function workRefKey(ref?: string | null): string {
  const value = (ref ?? "").trim().toLowerCase();
  if (!value) return "";
  const imdb = extractImdbId(value);
  if (imdb) return `imdb:${imdb}`;
  const mal = /myanimelist\.net\/anime\/(\d+)/.exec(value);
  if (mal) return `mal:${mal[1]}`;
  const elc = /elcinema\.com\/work\/(\d+)/.exec(value);
  if (elc) return `elc:${elc[1]}`;
  return "";
}

const ARABIC_SCRIPT = /[؀-ۿ]/;
const LATIN_LETTER = /[a-z]/i;
// An entry titled only in Arabic script (no Latin title at all) is the Arabic-dubbed release -
// the originals keep their Latin title in en_title.
function isArabicOnlyEntry(item: { en_title?: string; ar_title?: string }): boolean {
  const titles = [item.en_title, item.ar_title].filter((t): t is string => !!t?.trim());
  return titles.length > 0 && titles.every((t) => ARABIC_SCRIPT.test(t) && !LATIN_LETTER.test(t));
}

// The dubbed release: either titled only in Arabic (One Piece's "ون بيس"), or - the usual case for
// films - marked in its title ("Moana Dubbed" / "موانا مدبلج", "Toy Story 5 Dubbed"), which the
// Arabic-only check alone missed, so films never showed the subtitled/dubbed choice.
const DUB_MARKER = /dubbed|مدبلج/i;
function isDubbedEntry(item: { en_title?: string; ar_title?: string; other_title?: string }): boolean {
  return isArabicOnlyEntry(item) || [item.en_title, item.ar_title, item.other_title].some((t) => !!t && DUB_MARKER.test(t));
}

const versionCache = new Map<string, SourceVersion[]>();

// Wording sources add to a version's title ("... مدبلج", "(مترجم)") - not part of the work's name.
function stripVersionWords(title: string): string {
  return title.replace(/\(?\s*(مدبلج(ة)?|مترجم(ة)?|بالعربي(ة)?|النسخة المدبلجة)\s*\)?/g, " ").trim();
}

export async function findSourceVersions(movie: Movie): Promise<SourceVersion[]> {
  // An admin-pinned title plays exactly what was pinned - never second-guessed here.
  if (movie.sourceLinks?.length) return [];
  const cached = versionCache.get(movie.id);
  if (cached) return cached;
  const type = movie.type === "series" ? "series" : "movie";
  // A search that failed (timeout, blocked request) used to count as "no results", and the empty
  // answer was then cached for the whole session - so one slow moment on the TV's connection hid
  // the subtitled/dubbed button for that title until the app restarted. Failures are tracked now:
  // an empty result is only cached when every search actually answered, otherwise this throws and
  // the caller tries again.
  let failed = false;
  const onFail = <T,>(fallback: T) => () => {
    failed = true;
    return fallback;
  };
  const search = async (queries: string[]) => {
    const [cin, cee] = await Promise.all([
      Promise.all(queries.map((q) => searchCinemana(q, type).catch(onFail([] as CinemanaSearchItem[])))),
      Promise.all(queries.map((q) => searchCee(q, type).catch(onFail([] as CeeSearchItem[])))),
    ]);
    return { cin: cin.flat(), cee: cee.flat() as CinemanaSearchItem[] };
  };
  const baseQueries = [...new Set([movie.titleEn, movie.originalTitle, movie.titleAr].filter((t): t is string => !!t?.trim()))];
  const first = await search(baseQueries);
  const best = matchTmdbWithCinemana(movie, first.cin) ?? matchTmdbWithCinemana(movie, first.cee);
  if (!best) {
    if (failed) throw new Error("source search failed");
    versionCache.set(movie.id, []);
    return [];
  }
  const key = workRefKey(best.imdbUrlRef);
  // The dubbed entry is often titled differently (only in Arabic) - also search by every title
  // the matched entry itself carries.
  // Dubbed films are commonly filed as "<Arabic title> مدبلج" too.
  const arabicTitle = movie.titleAr?.trim() || (ARABIC_SCRIPT.test(best.ar_title ?? "") ? best.ar_title?.trim() : "");
  const extraQueries = [best.ar_title, best.en_title, (best as { other_title?: string }).other_title, arabicTitle ? `${arabicTitle} مدبلج` : ""]
    .map((t) => t?.trim())
    .filter((t): t is string => !!t && !baseQueries.includes(t));
  const more = extraQueries.length ? await search([...new Set(extraQueries)]) : { cin: [], cee: [] };
  const groups = new Map<string, SourceVersion>();
  // Two ways an entry counts as a version of this work: it carries the same external reference, or
  // - for the many dubbed entries that carry none (common for films) - it's titled only in Arabic,
  // with the same Arabic title once dub/sub wording is set aside, and the same year (+/-1). An
  // entry carrying a *different* reference is never grouped in.
  const wantedArabic = normalizeTitle(stripVersionWords(arabicTitle || ""));
  const year = movie.year ?? cinemanaNumber(best.year);
  const belongs = (item: CinemanaSearchItem) => {
    if (String(item.nb) === String(best.nb)) return true;
    const itemKey = workRefKey(item.imdbUrlRef);
    if (key && itemKey === key) return true;
    if (itemKey) return false;
    const itemYear = cinemanaNumber(item.year);
    if (!year || !itemYear || Math.abs(itemYear - year) > 1) return false;
    return !!wantedArabic && isDubbedEntry(item) && normalizeTitle(stripVersionWords(item.ar_title || item.en_title || "")) === wantedArabic;
  };
  const add = (items: CinemanaSearchItem[], provider: "cinemana" | "cee") => {
    for (const item of items) {
      if (item.nb == null || !belongs(item)) continue;
      const nb = String(item.nb);
      let group = groups.get(nb);
      if (!group) {
        group = { key: nb, dubbed: isDubbedEntry(item), title: (item.ar_title || item.en_title || "").trim(), sources: [] };
        groups.set(nb, group);
      }
      if (group.sources.some((source) => source.provider === provider)) continue;
      group.sources.push(
        provider === "cee"
          ? { provider: "cee", ceeId: makeCeeId(nb), available: true }
          : { provider: "cinemana", cinemanaId: makeCinemanaId(nb), available: true }
      );
    }
  };
  add([...first.cin, ...more.cin], "cinemana");
  add([...first.cee, ...more.cee], "cee");
  const bestNb = String(best.nb);
  const versions = [...groups.values()].sort((a, b) => (a.key === bestNb ? -1 : b.key === bestNb ? 1 : 0));
  // Only a real language choice is offered: one subtitled and one Arabic-dubbed version. Several
  // entries of the same kind (e.g. two uploads of the subtitled original) used to show the button
  // too, switching between two "مترجم" versions - reported as the button doing nothing on films,
  // and as showing on titles that have no dub at all.
  const subtitled = versions.find((v) => !v.dubbed);
  const dubbed = versions.find((v) => v.dubbed);
  const result = subtitled && dubbed ? (versions[0] === dubbed ? [dubbed, subtitled] : [subtitled, dubbed]) : [];
  if (!result.length && failed) throw new Error("source search failed");
  versionCache.set(movie.id, result);
  return result;
}

export async function findCeeMatch(movie: Movie): Promise<PlaybackMapping | null> {
  const linked = movie.sourceLinks?.find((link) => link.source === "cee");
  if (linked) return { provider: "cee", ceeId: makeCeeId(linked.nb), kind: linked.kind, available: true };
  const cacheKey = `${movie.id}:cee`;
  const cached = cinemanaMatchCache.get(cacheKey);
  if (cached) return cached;
  const type = movie.type === "series" ? "series" : "movie";
  try {
    const queries = [...new Set([movie.titleEn, movie.originalTitle, movie.titleAr].filter((title): title is string => !!title?.trim()))];
    const groups = await Promise.all(queries.map((query) => searchCee(query, type)));
    const match = matchTmdbWithCinemana(movie, groups.flat() as CeeSearchItem[]);
    if (!match || match.nb == null) return null;
    const playback: PlaybackMapping = { provider: "cee", ceeId: makeCeeId(match.nb), available: true };
    cacheMatch(cacheKey, playback);
    return playback;
  } catch {
    return null;
  }
}

// A series entry standing in for a movie (a play a source files under "series"): its actual video lives on
// the entry's first episode, so that is what gets played.
function firstEpisodeNb(rows: Array<{ nb?: string | number; season?: string | number; episodeNummer?: string | number }>): string | null {
  const sorted = rows
    .filter((row) => row.nb != null)
    .sort(
      (a, b) =>
        (cinemanaNumber(a.season) ?? 1) - (cinemanaNumber(b.season) ?? 1) ||
        (cinemanaNumber(a.episodeNummer) ?? 0) - (cinemanaNumber(b.episodeNummer) ?? 0)
    );
  return sorted[0]?.nb != null ? String(sorted[0].nb) : null;
}

async function fetchCeePlaybackAs(rawCeeId: string, kind: "movie" | "series"): Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }> {
  let ceeId = rawCeeId;
  if (kind === "series") {
    const nb = firstEpisodeNb(await fetchCeeEpisodes(rawCeeId));
    if (!nb) return { servers: [], subtitles: [] };
    ceeId = makeCeeId(nb);
  }
  const [videos, info] = await Promise.all([fetchCeeVideos(ceeId), fetchCeeInfo(ceeId)]);
  return { servers: mapCinemanaVideos(videos), subtitles: mapCinemanaSubtitles(info) };
}

// A pinned link records which section the source files the entry under, and that is easy to get wrong by
// hand (a play filed as a series, a series filed as a movie) - so when the recorded kind yields no video,
// the other reading is tried before giving up, instead of the link silently playing nothing.
export async function fetchCeeMoviePlayback(rawCeeId: string, kind: "movie" | "series" = "movie"): Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }> {
  let first: { servers: StreamServer[]; subtitles: SubtitleTrack[] } = { servers: [], subtitles: [] };
  try {
    first = await fetchCeePlaybackAs(rawCeeId, kind);
  } catch {
    return first;
  }
  if (first.servers.length) return first;
  try {
    const other = await fetchCeePlaybackAs(rawCeeId, kind === "movie" ? "series" : "movie");
    return other.servers.length ? other : first;
  } catch {
    return first;
  }
}

function mapCinemanaInfo(info: CinemanaInfo, id: string, type: "movie" | "series"): Movie {
  const title = info.en_title?.trim() || info.ar_title?.trim() || id;
  return {
    id,
    titleAr: info.ar_title?.trim() || title,
    titleEn: title,
    poster: info.imgObjUrl || info.imgThumbObjUrl,
    rating: cinemanaNumber(info.stars),
    year: cinemanaNumber(info.year),
    type,
    storyAr: info.ar_content,
    storyEn: info.en_content,
    trailerUrl: info.trailer,
    servers: [],
  };
}

function mapCinemanaVideos(videos: Array<{ resolution?: string; videoUrl?: string; url?: string; name?: string }>): StreamServer[] {
  return videos
    .map((video) => ({
      name: video.name || video.resolution || "Cinemana",
      url: video.videoUrl || video.url || "",
      quality: video.resolution || "",
    }))
    .filter((server) => !!server.url);
}

function mapCinemanaSubtitles(info: CinemanaInfo): SubtitleTrack[] {
  return (info.translations ?? [])
    .map((track) => ({
      language: track.name || "",
      url: track.file || track.url || "",
      defaultOffsetMs: 0,
      defaultSpeed: 1,
    }))
    .filter((track) => !!track.url);
}

function mapCinemanaEpisode(episode: CinemanaEpisode): Episode | null {
  if (episode.nb == null) return null;
  const title = episode.en_title?.trim() || episode.ar_title?.trim();
  if (!title) return null;
  return {
    id: makeCinemanaId(episode.nb),
    cinemanaId: makeCinemanaId(episode.nb),
    number: cinemanaNumber(episode.episodeNummer) ?? 0,
    titleAr: episode.ar_title?.trim() || title,
    titleEn: title,
    thumbnail: episode.imgThumbObjUrl || episode.imgObjUrl,
    storyAr: episode.ar_content,
    storyEn: episode.en_content,
    hasPlayableStream: true,
    servers: [],
    subtitles: (episode.translations ?? [])
      .map((track) => ({ language: track.name || "", url: track.file || track.url || "", defaultOffsetMs: 0, defaultSpeed: 1 }))
      .filter((track) => !!track.url),
  };
}

// Summary-level data (list/search endpoints) has no genres/cast/director/writer yet - only the
// per-movie detail call does. titleAr/overviewAr, though, are now on the summary DTO itself (see
// its own comment in dto.ts) specifically so every screen shows the real Arabic title/overview
// immediately, not just after opening the detail screen - titleAr used to fall back to the
// English title unconditionally here even when a real Arabic one existed.
function mapSummary(m: MovieSummaryDto): Movie {
  return {
    id: m.id,
    titleAr: m.titleAr?.trim() || m.title,
    titleEn: m.title,
    poster: m.artwork?.poster,
    backdrop: m.artwork?.backdrop,
    logoUrl: m.artwork?.logo,
    // Now sent on every summary/detail response (see MovieSummaryDto's own comment) - lets
    // calculateMatchScore's exact-IMDb-id fast path fire regardless of where this title was
    // opened from, not just Search (the one place that used to carry it).
    imdbId: extractImdbId(m.imdbId),
    rating: m.rating ?? undefined,
    year: m.releaseDate ? new Date(m.releaseDate).getUTCFullYear() : undefined,
    type: "movie",
    storyAr: m.overviewAr ?? undefined,
    storyEn: m.overview ?? undefined,
    duration: formatRuntime(m.runtime),
    genres: m.genres,
    ageRating: m.ageRating ?? undefined,
    language: m.originalLanguage ?? undefined,
    collectionId: m.collectionId ?? undefined,
    partNumber: m.partNumber ?? undefined,
    // Known from the summary itself (server-computed) - drives the Play vs "Coming Soon"
    // affordance immediately, without waiting on the per-movie detail fetch that actually
    // resolves `servers` (see mapDetail/fetchMovieDetail below).
    hasPlayableStream: m.hasPlayableStream,
    servers: [],
  };
}

export interface StreamServer {
  name: string;
  url: string;
  // Raw string as the backend reports it (e.g. "1080p", "720p") - see streamSelect.ts's own
  // qualityRank() for how this gets turned into a sortable number.
  quality: string;
}

function mapStreams(streams: StreamDto[]): StreamServer[] {
  return streams.map((s) => ({ name: s.serverName || s.quality, url: s.streamUrl, quality: s.quality }));
}

// The single highest resolution actually available for this movie right now (e.g. "4K"/"1080p") -
// shown next to the age rating/IMDb rating on MovieDetailsScreen's hero facts row (and reused
// as-is by VideoPlayer's own header facts row). Undefined when there are no servers at all yet,
// so that row's existing `{!!movie.quality && ...}` guard just renders nothing instead of "0p".
export function bestQualityLabel(servers: StreamServer[]): string | undefined {
  if (!servers.length) return undefined;
  const best = servers.reduce((a, b) => (qualityRank(b.quality) > qualityRank(a.quality) ? b : a));
  return qualityLabel(best.quality);
}

function mapSubtitleTracks(subtitles: SubtitleDto[]): SubtitleTrack[] {
  return subtitles.map((s) => ({
    language: s.language,
    url: s.url,
    defaultOffsetMs: s.defaultOffsetMs,
    defaultSpeed: s.defaultSpeed,
  }));
}

function mapCastMember(c: CastMemberDto): CastMember {
  return {
    id: c.id,
    name: c.name,
    role: c.character ?? undefined,
    photoUrl: c.photo ?? undefined,
    birthday: c.birthday ?? undefined,
    deathday: c.deathday ?? undefined,
    biography: c.biography ?? undefined,
    biographyAr: c.biographyAr ?? undefined,
    placeOfBirth: c.placeOfBirth ?? undefined,
  };
}

function mapDetail(m: MovieDetailDto): Movie {
  const servers = mapStreams(m.streams ?? []);
  return {
    ...mapSummary(m),
    genres: m.genres,
    director: m.director ? mapCastMember(m.director) : undefined,
    writer: m.writer ? mapCastMember(m.writer) : undefined,
    country: m.country ?? undefined,
    servers,
    subtitles: mapSubtitleTracks(m.subtitles ?? []),
    hasPlayableStream: servers.length > 0,
    quality: bestQualityLabel(servers),
    castMembers: m.cast.map(mapCastMember),
    actors: m.cast.slice(0, 5).map((c) => c.name),
    // MovieDetailDto had no field for this at all until now (see the backend's own dto.ts/
    // movieQueryRepository.ts comment) - every movie's trailer, however correctly TMDB import
    // found and stored it, was silently discarded before ever reaching this mapper.
    trailerUrl: m.trailerUrl ?? undefined,
    sourceLinks: m.sourceLinks,
    // Was dropped here, so a movie was never searched for (or matched) by its original title -
    // the only Arabic name on file for many Arabic-language movies.
    originalTitle: m.originalTitle ?? undefined,
  };
}

// Show summaries map onto the same Movie shape BrowseScreen/HomeScreen/SearchScreen already
// render for movies - MovieCard/HomeScreen only ever branch on `type` for the label (see
// HomeScreen's hero meta text), so a show never needs its own card component.
function mapShowSummary(s: ShowSummaryDto): Movie {
  return {
    id: s.id,
    titleAr: s.titleAr?.trim() || s.title,
    titleEn: s.title,
    poster: s.artwork?.poster,
    backdrop: s.artwork?.backdrop,
    logoUrl: s.artwork?.logo,
    imdbId: extractImdbId(s.imdbId),
    rating: s.rating ?? undefined,
    year: s.releaseDate ? new Date(s.releaseDate).getUTCFullYear() : undefined,
    type: "series",
    storyAr: s.overviewAr ?? undefined,
    storyEn: s.overview ?? undefined,
    genres: s.genres,
    ageRating: s.ageRating ?? undefined,
    language: s.originalLanguage ?? undefined,
    servers: [],
  };
}

function mapEpisode(e: EpisodeSummaryDto): Episode {
  return {
    id: e.id,
    number: e.episodeNumber,
    titleAr: e.titleAr?.trim() || e.title,
    titleEn: e.title,
    duration: formatRuntime(e.runtime),
    thumbnail: e.stillImage ?? undefined,
    storyAr: e.overviewAr ?? undefined,
    storyEn: e.overview ?? undefined,
    airDate: e.airDate ?? undefined,
    hasPlayableStream: e.hasPlayableStream,
    servers: [],
  };
}

async function fetchSeasonDetail(seasonId: string): Promise<SeasonDetailDto> {
  const { data } = await apiGet<SeasonDetailDto>(`/seasons/${seasonId}`);
  return data;
}

type ProviderEpisodeRow = Awaited<ReturnType<typeof fetchCinemanaEpisodes>>[number];

function cumulativeOffsets(counts: Map<number, number>): Map<number, number> {
  const offsets = new Map<number, number>();
  let running = 0;
  for (const seasonNumber of [...counts.keys()].sort((a, b) => a - b)) {
    offsets.set(seasonNumber, running);
    running += counts.get(seasonNumber) ?? 0;
  }
  return offsets;
}

// Sources and TMDB don't agree on how a long series is split - typically Turkish series: one
// side lists it as several seasons (S2E5) while the other numbers the whole run continuously as
// one season (S1E45), in either direction. Matching purely on "season:episode" then only ever
// hits the first season (or nothing). This tries both layouts - direct season:episode, and
// "absolute" position (episodes counted continuously across seasons on both sides) - and uses
// whichever one actually matches more of this show's episodes, so the layout is detected per
// source per show rather than assumed.
function pickEpisodeLookup(
  providerEpisodes: ProviderEpisodeRow[],
  seasons: Season[],
): (seasonNumber: number, episodeNumber: number) => ProviderEpisodeRow | undefined {
  const direct = new Map<string, ProviderEpisodeRow>();
  const providerCounts = new Map<number, number>();
  for (const row of providerEpisodes) {
    const seasonNumber = cinemanaNumber(row.season) ?? 1;
    direct.set(`${seasonNumber}:${cinemanaNumber(row.episodeNummer) ?? 0}`, row);
    if (seasonNumber > 0) providerCounts.set(seasonNumber, (providerCounts.get(seasonNumber) ?? 0) + 1);
  }
  const providerOffsets = cumulativeOffsets(providerCounts);
  const absolute = new Map<number, ProviderEpisodeRow>();
  for (const row of providerEpisodes) {
    const seasonNumber = cinemanaNumber(row.season) ?? 1;
    if (seasonNumber <= 0) continue;
    absolute.set((providerOffsets.get(seasonNumber) ?? 0) + (cinemanaNumber(row.episodeNummer) ?? 0), row);
  }
  const ownCounts = new Map<number, number>(seasons.filter((s) => s.number > 0).map((s) => [s.number, s.episodes.length]));
  const ownOffsets = cumulativeOffsets(ownCounts);

  const byDirect = (seasonNumber: number, episodeNumber: number) => direct.get(`${seasonNumber}:${episodeNumber}`);
  const byAbsolute = (seasonNumber: number, episodeNumber: number) =>
    seasonNumber > 0 ? absolute.get((ownOffsets.get(seasonNumber) ?? 0) + episodeNumber) : undefined;

  let directHits = 0;
  let absoluteHits = 0;
  for (const season of seasons) {
    for (const episode of season.episodes) {
      if (byDirect(season.number, episode.number)) directHits += 1;
      if (byAbsolute(season.number, episode.number)) absoluteHits += 1;
    }
  }
  return absoluteHits > directHits ? byAbsolute : byDirect;
}

// MovieDetailsScreen renders the active season's full episode list (titles/thumbnails/runtime)
// as soon as the screen mounts, so those need to be loaded up front per season - but never a
// per-episode stream lookup for every episode of every season just to show a grid. Play
// resolves the real link lazily instead (see fetchEpisodeStreams), the moment the viewer
// actually selects an episode.
export async function fetchShowDetail(id: string, playback?: PlaybackMapping, playbackSources?: PlaybackMapping[]): Promise<Movie> {
  // A series can be matched on BOTH cinemana and cee while only one of them actually has every
  // episode (the other's catalog is stale/partial) - picking a single "winning" provider here
  // used to leave every episode the winner didn't have stuck on "Coming Soon" even though the
  // other provider had it. Every matched source now gets tried, not just the first.
  let sources = playbackSources?.length ? playbackSources : playback ? [playback] : [];
  if (!isCinemanaId(id)) {
    // Looked up even when sources were handed in: a show opened from Search arrives with automatic matches
    // already attached, and those must not override entries the admin pinned by hand.
    const catalogShow = await apiGet<ShowDetailDto>(`/shows/${id}`);
    const pinned = catalogShow.data.sourceLinks?.length;
    if (pinned || !sources.length) {
      const show = { ...mapShowSummary(catalogShow.data), sourceLinks: catalogShow.data.sourceLinks, originalTitle: catalogShow.data.originalTitle ?? undefined };
      const matches = await Promise.all([findCinemanaMatch(show), findCeeMatch(show)]);
      sources = matches.filter((candidate): candidate is PlaybackMapping => !!candidate);
    }
  }
  if (isCinemanaId(id)) {
    const [info, episodeRows] = await Promise.all([fetchCinemanaInfo(id), fetchCinemanaEpisodes(id)]);
    const seasonMap = new Map<number, Episode[]>();
    for (const row of episodeRows) {
      const episode = mapCinemanaEpisode(row);
      const seasonNumber = cinemanaNumber(row.season) ?? 1;
      if (episode) seasonMap.set(seasonNumber, [...(seasonMap.get(seasonNumber) ?? []), episode]);
    }
    const movie = mapCinemanaInfo(info, id, "series");
    return {
      ...movie,
      seasons: [...seasonMap.entries()].sort(([a], [b]) => a - b).map(([number, episodes]) => ({
        id: `${id}:season:${number}`,
        number,
        titleAr: `الموسم ${number}`,
        titleEn: `Season ${number}`,
        episodes: episodes.sort((a, b) => a.number - b.number),
      })),
    };
  }
  const { data } = await apiGet<ShowDetailDto>(`/shows/${id}`);
  const seasons: Season[] = await Promise.all(
    data.seasons.map(async (s) => {
      const detail = await fetchSeasonDetail(s.id);
      return {
        id: s.id,
        number: s.seasonNumber,
        titleAr: s.name?.trim() || `الموسم ${s.seasonNumber}`,
        titleEn: s.name?.trim() || `Season ${s.seasonNumber}`,
        airDate: s.airDate ?? undefined,
        episodes: detail.episodes.map(mapEpisode),
      };
    }),
  );

  // Tried in order (cinemana source before cee, mirroring the old single-winner priority) but
  // every source is checked - an earlier source's episode gap is filled by the next one instead
  // of leaving it permanently stuck on "Coming Soon". Every source also gets its own independent
  // shot at an episode ALREADY claimed by an earlier one (no more "skip once hasPlayableStream is
  // true") - an episode can end up with both a ceeId and a cinemanaId recorded at once now, not
  // just whichever source happened to be checked first. That's what actually lets
  // fetchEpisodePlayback's own "try the next source if this one comes back empty" fallback ever
  // fire for a series - previously an episode only ever got a *single* source's id, so a dead
  // link on the first-tried source meant "not available," full stop, even when the other source
  // had a perfectly working copy of the exact same episode. Same root cause the earlier movie
  // fallback fix addressed, just one level deeper (per-episode instead of per-title).
  for (const source of sources) {
    const sourceId = source.cinemanaId || source.ceeId;
    if (!sourceId) continue;
    try {
      const providerEpisodes = source.provider === "cee" ? await fetchCeeEpisodes(sourceId) : await fetchCinemanaEpisodes(sourceId);
      const lookupEpisode = pickEpisodeLookup(providerEpisodes, seasons);
      for (const season of seasons) {
        for (const episode of season.episodes) {
          const alreadyHasThisSource = source.provider === "cee" ? !!episode.ceeId : !!episode.cinemanaId;
          if (alreadyHasThisSource) continue;
          const providerEpisode = lookupEpisode(season.number, episode.number);
          if (providerEpisode?.nb != null) {
            if (source.provider === "cee") episode.ceeId = makeCeeId(providerEpisode.nb);
            else episode.cinemanaId = makeCinemanaId(providerEpisode.nb);
            episode.hasPlayableStream = true;
            // Keeps the first source's subtitle set rather than the last-checked source's -
            // flipping tracks between two unrelated batches for the same episode on every reload
            // would be a worse experience than just picking one and staying with it.
            if (!episode.subtitles?.length) {
              episode.subtitles = (providerEpisode.translations ?? [])
                .map((track) => ({ language: track.name || "", url: track.file || track.url || "", defaultOffsetMs: 0, defaultSpeed: 1 }))
                .filter((track) => !!track.url);
            }
          }
        }
      }
    } catch {
      // One source being unavailable/mismatched shouldn't block the others.
    }
  }
  return {
    ...mapShowSummary(data),
    genres: data.genres,
    director: data.director ? mapCastMember(data.director) : undefined,
    writer: data.writer ? mapCastMember(data.writer) : undefined,
    creator: data.creator ? mapCastMember(data.creator) : undefined,
    country: data.country ?? undefined,
    seasons,
    castMembers: data.cast.map(mapCastMember),
    actors: data.cast.slice(0, 5).map((c) => c.name),
  };
}

// Called only once the viewer actually presses an episode - see the comment on
// fetchShowDetail above for why this isn't preloaded for every episode up front. Streams and
// subtitles are fetched together here since they're needed at the exact same moment (handed
// straight to VideoPlayerScreen via onPlay).
// An episode can carry BOTH a ceeId and a cinemanaId at once (see fetchShowDetail's own merge
// loop above - each source fills in whichever episodes it actually has, independently) - this
// used to return the instant ceeId was present and never even look at cinemanaId, even when CEE's
// own entry for that specific episode was dead/empty. Same "try the next source if this one
// yields nothing" fallback fetchCeeMoviePlayback/fetchCinemanaMoviePlayback already use for
// movies - a source is skipped, not trusted blindly, when it actually has nothing to play.
export async function fetchEpisodePlayback(
  episodeId: string,
  cinemanaId?: string,
  ceeId?: string,
): Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }> {
  const attempts: Array<() => Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }>> = [];
  if (ceeId) {
    attempts.push(async () => {
      const [videos, info] = await Promise.all([fetchCeeVideos(ceeId), fetchCeeInfo(ceeId)]);
      return { servers: mapCinemanaVideos(videos), subtitles: mapCinemanaSubtitles(info) };
    });
  }
  const providerId = cinemanaId || (isCinemanaId(episodeId) ? episodeId : undefined);
  if (providerId) {
    attempts.push(async () => {
      const [videos, info] = await Promise.all([fetchCinemanaEpisodeVideos(providerId), fetchCinemanaInfo(providerId)]);
      return { servers: mapCinemanaVideos(videos), subtitles: mapCinemanaSubtitles(info) };
    });
  }
  let last: { servers: StreamServer[]; subtitles: SubtitleTrack[] } = { servers: [], subtitles: [] };
  for (const attempt of attempts) {
    try {
      last = await attempt();
      if (last.servers.length) return last;
    } catch {
      // This source failed outright (network/timeout) - the next one still gets a fair try.
    }
  }
  if (attempts.length) return last;
  const [streamsRes, subtitlesRes] = await Promise.all([
    apiGet<StreamDto[]>(`/episodes/${episodeId}/streams`),
    apiGet<SubtitleDto[]>(`/episodes/${episodeId}/subtitles`),
  ]);
  return { servers: mapStreams(streamsRes.data), subtitles: mapSubtitleTracks(subtitlesRes.data) };
}

// MovieDetailsScreen only ever receives whatever summary-level Movie was tapped (from Home,
// Browse, or Search) - this is what enriches it with the fields only the detail endpoint has
// (titleAr, genres, cast, director). Safe to call for any movie id; harmless if the screen
// already had full data.
export async function fetchMovieDetail(id: string): Promise<Movie> {
  if (isCinemanaId(id)) {
    const [info, videos] = await Promise.all([fetchCinemanaInfo(id), fetchCinemanaVideos(id)]);
    const movie = mapCinemanaInfo(info, id, "movie");
    const servers = mapCinemanaVideos(videos);
    return { ...movie, servers, subtitles: mapCinemanaSubtitles(info), hasPlayableStream: servers.length > 0, quality: bestQualityLabel(servers) };
  }
  const { data } = await apiGet<MovieDetailDto>(`/movies/${id}`);
  return mapDetail(data);
}

async function fetchCinemanaPlaybackAs(rawCinemanaId: string, kind: "movie" | "series"): Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }> {
  if (kind === "series") {
    const nb = firstEpisodeNb(await fetchCinemanaEpisodes(rawCinemanaId));
    if (!nb) return { servers: [], subtitles: [] };
    const episodeId = makeCinemanaId(nb);
    const [videos, info] = await Promise.all([fetchCinemanaEpisodeVideos(episodeId), fetchCinemanaInfo(episodeId)]);
    return { servers: mapCinemanaVideos(videos), subtitles: mapCinemanaSubtitles(info) };
  }
  const cinemanaId = rawCinemanaId;
  const [videos, info] = await Promise.all([fetchCinemanaVideos(cinemanaId), fetchCinemanaInfo(cinemanaId)]);
  return { servers: mapCinemanaVideos(videos), subtitles: mapCinemanaSubtitles(info) };
}

// Same "try the other kind when the recorded one is empty" fallback as fetchCeeMoviePlayback.
export async function fetchCinemanaMoviePlayback(rawCinemanaId: string, kind: "movie" | "series" = "movie"): Promise<{ servers: StreamServer[]; subtitles: SubtitleTrack[] }> {
  let first: { servers: StreamServer[]; subtitles: SubtitleTrack[] } = { servers: [], subtitles: [] };
  try {
    first = await fetchCinemanaPlaybackAs(rawCinemanaId, kind);
  } catch {
    return first;
  }
  if (first.servers.length) return first;
  try {
    const other = await fetchCinemanaPlaybackAs(rawCinemanaId, kind === "movie" ? "series" : "movie");
    return other.servers.length ? other : first;
  } catch {
    return first;
  }
}

export interface SubtitleTrack {
  language: string;
  url: string;
  // The server-computed sync correction for this exact subtitle file, applied as the starting
  // default when the viewer has no local override of their own.
  defaultOffsetMs: number;
  defaultSpeed: number;
}

export interface Episode {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  duration?: string;
  thumbnail?: string;
  storyAr?: string;
  storyEn?: string;
  // Whether admin has attached at least one active stream to this episode yet - drives the
  // same "قريبًا"/Coming Soon fallback movies/shows already use (see HomeScreen/
  // MovieDetailsScreen). The actual playable link is resolved lazily on tap, not preloaded
  // here - see fetchEpisodePlayback in api.ts.
  hasPlayableStream?: boolean;
  // Only ever imported once aired or airing within 7 days (see AIR_DATE_IMPORT_HORIZON_DAYS in
  // bootstrap-importer.mjs) - a future date here means it's an announced-but-not-yet-aired
  // episode, worth showing as "coming <date>" rather than looking like a normal (just
  // stream-less) one.
  airDate?: string;
  servers: StreamServer[];
  subtitles?: SubtitleTrack[];
  cinemanaId?: string;
  ceeId?: string;
}

export interface Season {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  airDate?: string;
  episodes: Episode[];
}

export interface CastMember {
  id: string;
  name: string;
  role?: string;
  photoUrl?: string;
  // Only present once the import system has fetched this person's own TMDB detail record (not
  // every cast credit does - see server.ts) - birthday is ISO ("1967-07-26"), placeOfBirth and
  // biography are whatever TMDB itself returns (usually English, occasionally untranslated).
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  biography?: string;
  // Gemini-translated from `biography` server-side (TMDB itself rarely has an Arabic
  // translation for a person's biography specifically) - shown instead of `biography` when the
  // app's own language is Arabic, falling back to the English one if this isn't there yet.
  biographyAr?: string;
}

export interface Movie {
  id: string;
  sourceLinks?: SourceLink[];
  titleAr: string;
  titleEn: string;
  originalTitle?: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  year?: number;
  type?: string;
  storyAr?: string;
  storyEn?: string;
  genres?: string[];
  duration?: string;
  actors?: string[];
  castMembers?: CastMember[];
  servers?: StreamServer[];
  subtitles?: SubtitleTrack[];
  // Known from the summary itself (movies only - shows never render a direct Play affordance
  // on their own card/hero), so Play vs "Coming Soon" is correct immediately on Home/Browse/
  // Search without waiting on the per-movie detail fetch that actually resolves `servers`.
  hasPlayableStream?: boolean;
  seasons?: Season[];
  logoUrl?: string;
  titleLogo?: string;
  ageRating?: string;
  country?: string;
  quality?: string;
  trailerUrl?: string;
  language?: string;
  views?: number;
  // Set only on movies admin has explicitly linked into a multi-entry series (a franchise) -
  // shared across every part of that same series, with partNumber giving each entry's order
  // within it.
  collectionId?: string;
  partNumber?: number;
  // Full CastMember (not just name/id/photo) so PersonScreen has the same birthday/biography/
  // placeOfBirth for a director or writer as it does for a regular cast member - these used to
  // be split into separate director/directorId/directorPhotoUrl fields that only ever carried
  // enough to show a name and thumbnail, silently dropping the rest of what the backend already
  // sends (see CastMemberDto).
  director?: CastMember;
  writer?: CastMember;
  // Shows only - see ShowDetailDto.creator's own comment for why this isn't just `director`.
  creator?: CastMember;
  imdbId?: string;
  playback?: PlaybackMapping;
  playbackSources?: PlaybackMapping[];
}

// trailerUrl is always a YouTube watch link by convention (see server.ts's own field
// description) - never a direct video file, so react-native-video can never play it. Pull
// the video id out for a YouTube embed player instead.
export function youtubeVideoId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// A real page hosted on this backend's own domain (youtubeEmbed.controller.ts - see its own
// comment for the full reasoning) - loaded as an actual WebView navigation (`source.uri`), not
// the old `source.html` + fake `baseUrl` trick both YouTube embeds in this app used to build
// locally. That trick was the real cause of a long-standing bug where *every* YouTube embed
// silently failed everywhere (not just full-movie playback, but the trailer preview too, on every
// device) - the origin it faked never actually satisfied the IFrame Player API's own validation.
export function youtubeEmbedUrl(
  videoId: string,
  opts: {
    autoplay?: boolean;
    mute?: boolean;
    controls?: boolean;
    loop?: boolean;
    unmuteOnPlay?: boolean;
    // Lets the movie's own backdrop image (already sitting behind this WebView) show through
    // during the load/buffer gap instead of a plain black rectangle - see the backend's own
    // comment. Defaults to solid black, right for the full-screen player, which has nothing of
    // its own behind the WebView to show through anyway.
    transparentBg?: boolean;
    // A details-screen background trailer: small rendition, YouTube's overlays cropped out, no
    // time polling - see the backend's youtube-embed preview mode.
    preview?: boolean;
  } = {}
): string {
  const params = new URLSearchParams({ v: videoId });
  if (opts.autoplay === false) params.set("autoplay", "0");
  if (opts.mute === false) params.set("mute", "0");
  if (opts.controls) params.set("controls", "1");
  if (opts.loop) params.set("loop", "1");
  if (opts.unmuteOnPlay) params.set("unmuteOnPlay", "1");
  if (opts.transparentBg) params.set("bg", "transparent");
  // pv: the preview page's own layout version - the page is cached for a day (see the backend), so
  // bumping this when its layout changes is what makes TVs fetch the new one.
  if (opts.preview) {
    params.set("preview", "1");
    params.set("pv", "3");
  }
  return `${API_BASE}/youtube-embed?${params.toString()}`;
}

export function movieUrl(u?: string): string | undefined {
  if (!u) return undefined;
  return u.startsWith("http") ? u : `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;
}

export interface Category {
  id: string;
  titleAr: string;
  titleEn: string;
  items: Movie[];
  // For rows whose home strip only carries a short head of the list (the built-in Newest / Popular /
  // Top rated / Series): fetches the fuller list the "View more" screen shows. Rows that already arrive
  // with all their items (custom / smart lists) leave this unset.
  loadAll?: () => Promise<Movie[]>;
}

// Shared with HomeScreen.tsx's own row rendering (imported from there, not duplicated) - how many
// items a home row's collapsed strip actually displays before its own "View more" card. Lives
// here (not HomeScreen) so sectionsToCategories below can compare against the exact same number
// deciding whether that card should even appear.
export const HOME_ROW_MAX_ITEMS = 20;
const VIEW_MORE_LIMIT = 100;

// The full list behind each built-in row, for the "View more" screen - the same ordering the row itself uses,
// just deeper (the home strip only fetches 20).
const builtInLoaders: Record<string, () => Promise<Movie[]>> = {
  RECENT: async () => {
    const [movies, shows] = await Promise.all([
      apiGet<MovieSummaryDto[]>(`/movies?sort=releaseDate&limit=${VIEW_MORE_LIMIT}`),
      apiGet<ShowSummaryDto[]>(`/shows?sort=releaseDate&limit=${VIEW_MORE_LIMIT}`),
    ]);
    const now = Date.now();
    return [
      ...movies.data.map((m) => ({ date: m.releaseDate, item: mapSummary(m) })),
      ...shows.data.map((sh) => ({ date: sh.releaseDate, item: mapShowSummary(sh) })),
    ]
      .filter((x) => !x.date || new Date(x.date).getTime() <= now)
      .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
      .slice(0, VIEW_MORE_LIMIT)
      .map((x) => x.item);
  },
  POPULAR: async () => (await apiGet<MovieSummaryDto[]>(`/movies?sort=popularity&limit=${VIEW_MORE_LIMIT}`)).data.map(mapSummary),
  TOP_RATED: async () => (await apiGet<MovieSummaryDto[]>(`/movies?sort=rating&limit=${VIEW_MORE_LIMIT}`)).data.map(mapSummary),
  SERIES: async () => (await apiGet<ShowSummaryDto[]>(`/shows?sort=popularity&limit=${VIEW_MORE_LIMIT}`)).data.map(mapShowSummary),
};

// Admin-managed home rows (see the backend's home/sections endpoint). The four built-in kinds carry
// no items (this file already computes those lists below); CUSTOM rows carry their own.
interface HomeSectionDto {
  id: string;
  kind: "RECENT" | "POPULAR" | "TOP_RATED" | "SERIES" | "CUSTOM" | "RULE";
  titleAr: string;
  titleEn: string;
  items: FeaturedItemDto[] | null;
  // True when this row's own maxItems cap is hiding more matches - drives whether a CUSTOM/RULE
  // row's "View more" card appears at all (see sectionsToCategories below).
  hasMore: boolean;
}

export interface MoviesResponse {
  hero: Movie;
  heroMovies: Movie[];
  categories: Category[];
}

export interface AppUpdateInfo {
  versionCode: number;
  versionName: string;
  url: string;
  notesAr?: string | null;
  notesEn?: string | null;
}

// Backs SettingsScreen's manual "check for update" - compares against appVersion.ts's
// CURRENT_VERSION_CODE, which is bumped by hand alongside build.gradle on every release.
export async function fetchAppUpdate(): Promise<AppUpdateInfo> {
  const { data } = await apiGet<AppUpdateInfo>("/app/version");
  return data;
}

// The app's "View more" screen for a CUSTOM/RULE row - the backend's own display cap (maxItems)
// only ever sends the row's own head; this asks for the fuller list past it (see homeSections.ts's
// own fullItems on the backend).
async function fetchHomeSectionItems(sectionId: string): Promise<Movie[]> {
  const { data } = await apiGet<FeaturedItemDto[]>(`/home/sections/${sectionId}/items?limit=100`);
  return data.map((item) => (item.type === "show" ? mapShowSummary(item) : mapSummary(item)));
}

// Rows in the admin's own order, hidden ones already dropped server-side. A row that ends up empty
// (a custom list whose titles aren't published, say) is skipped rather than shown as a blank rail.
function sectionsToCategories(sections: HomeSectionDto[], builtIn: Record<string, Movie[]>): Category[] {
  return sections
    .map((section) => {
      const items = section.items
        ? section.items.map((item) => (item.type === "show" ? mapShowSummary(item) : mapSummary(item)))
        : builtIn[section.kind] ?? [];
      return {
        id: section.id,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        items,
        // For CUSTOM/RULE, "more to show" is two separate questions, either one enough on its own:
        // (a) did the backend already send more than a home row's own strip displays (its own
        // maxItems can be well above the fixed HOME_ROW_MAX_ITEMS - e.g. a 50-item "top rated"
        // import shows only 20 in the strip but already has the other 30 in hand, no fetch needed)
        // (b) does the backend say there's more still beyond even what it sent (section.hasMore -
        // a row capped at exactly maxItems, the case (a) alone can't see). Checking only (b) - an
        // earlier version of this - made a 50-item row's own "View more" vanish entirely, since
        // 50 items sitting at that section's own 50-item cap reads as "no more" to (b) alone even
        // though the strip itself only ever showed 20 of them.
        loadAll: section.items
          ? items.length > HOME_ROW_MAX_ITEMS || section.hasMore
            ? () => fetchHomeSectionItems(section.id)
            : undefined
          : builtInLoaders[section.kind],
      };
    })
    .filter((category) => category.items.length > 0);
}

// The new backend has no single "home" aggregate endpoint yet - this assembles the same shape
// (hero + a few rails) from plain sorted movie/show lists instead.
export async function fetchMovies(): Promise<MoviesResponse> {
  const [newestMoviesRes, newestShowsRes, popular, topRated, shows, featured, homeSections] = await Promise.all([
    // "newest" sorts by when the title was added to the catalog, not its actual release date -
    // this rail is labeled "الأحدث" (newest releases) to the viewer, so it needs releaseDate
    // (desc) instead: a movie imported today but released years ago shouldn't show up here.
    apiGet<MovieSummaryDto[]>("/movies?sort=releaseDate&limit=20"),
    // Fetched (and merged below) separately from the plain "series" rail further down, which is
    // popularity-sorted, not recency-sorted - without this, a recently-released series could never
    // appear under "الأحدث" at all, no matter how new, since that rail used to be built from
    // /movies alone. Reported as "recent series don't show up in the Newest list."
    apiGet<ShowSummaryDto[]>("/shows?sort=releaseDate&limit=20"),
    apiGet<MovieSummaryDto[]>("/movies?sort=popularity&limit=20"),
    apiGet<MovieSummaryDto[]>("/movies?sort=rating&limit=20"),
    apiGet<ShowSummaryDto[]>("/shows/popular"),
    apiGet<FeaturedItemDto[]>("/movies/featured"),
    // A failure here must never blank the home screen - no sections just means the four defaults.
    apiGet<HomeSectionDto[]>("/home/sections").then((res) => res.data).catch(() => [] as HomeSectionDto[]),
  ]);
  const newestMovies = newestMoviesRes.data.map(mapSummary);
  // Merged by each DTO's own raw releaseDate (not yet collapsed down to Movie.year, which only
  // has year-granularity - too coarse to interleave two lists released in the same year) rather
  // than concatenating the two already-sorted-individually lists end to end, which would always
  // put every movie ahead of every show (or vice versa) instead of true release-date order.
  const newestCombined = [
    ...newestMoviesRes.data.map((m) => ({ date: m.releaseDate, item: mapSummary(m) })),
    ...newestShowsRes.data.map((s) => ({ date: s.releaseDate, item: mapShowSummary(s) })),
  ]
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    .slice(0, 20)
    .map((x) => x.item);
  // Admin-curated selection (see the banner-management page) wins when set at all - falls back
  // to newest movies only so the hero is never empty before an admin has picked anything. The
  // banner can mix movies and shows in one admin-ordered sequence, so each item needs routing to
  // the mapper matching its own shape (a show summary has no `runtime`, a movie has no
  // `numberOfSeasons`, etc.) rather than assuming they're all movies.
  const heroMovies =
    featured.data.length > 0
      ? featured.data.map((item) => (item.type === "show" ? mapShowSummary(item) : mapSummary(item)))
      : newestMovies.slice(0, 10);
  const builtIn: Record<string, Movie[]> = {
    RECENT: newestCombined,
    POPULAR: popular.data.map(mapSummary),
    TOP_RATED: topRated.data.map(mapSummary),
    SERIES: shows.data.map(mapShowSummary),
  };
  const defaultCategories: Category[] = [
    { id: "recent", titleAr: "الأحدث", titleEn: "Recently Added", items: builtIn.RECENT, loadAll: builtInLoaders.RECENT },
    { id: "trending", titleAr: "الأكثر شعبية", titleEn: "Trending", items: builtIn.POPULAR, loadAll: builtInLoaders.POPULAR },
    { id: "top-rated", titleAr: "الأعلى تقييمًا", titleEn: "Top Rated", items: builtIn.TOP_RATED, loadAll: builtInLoaders.TOP_RATED },
    { id: "series", titleAr: "المسلسلات", titleEn: "TV Shows", items: builtIn.SERIES, loadAll: builtInLoaders.SERIES },
  ];
  return {
    hero: heroMovies[0],
    heroMovies,
    categories: homeSections.length > 0 ? sectionsToCategories(homeSections, builtIn) : defaultCategories,
  };
}

export interface MoviesPage {
  items: Movie[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

// Powers BrowseScreen's infinite scroll for both Movies and Series. `sort` matches the backend's
// own CatalogListQueryDto enum directly (see queryHelpers.ts's own SORT_FIELD map) - passing it
// straight through is what lets BrowseScreen's own sort stepper skip loading the entire remaining
// catalog just to re-sort it client-side (see that screen's own comment on why that used to be
// the only option): the server already returns each page in the requested order, so a sort change
// only ever needs a fresh page 1, not everything. `language`/`genre` are the same idea, also
// server-supported (CatalogListQueryDto.language/genre - language matched against
// originalLanguage, the exact field Movie.language below is itself mapped from, and genre matched
// against a linked Genre row's own name, the exact value Movie.genres is mapped from too - so
// passing this screen's own filter state straight through needs no translation either way).
export async function fetchMoviesPage(
  type: "movie" | "series",
  page: number,
  limit = 50,
  sort: "newest" | "releaseDate" | "rating" | "popularity" = "newest",
  language?: string,
  genre?: string
): Promise<MoviesPage> {
  const languageParam = language ? `&language=${encodeURIComponent(language)}` : "";
  const genreParam = genre ? `&genre=${encodeURIComponent(genre)}` : "";
  if (type === "series") {
    const { data, meta } = await apiGet<ShowSummaryDto[]>(`/shows?sort=${sort}&page=${page}&limit=${limit}${languageParam}${genreParam}`);
    const total = Number(meta?.total ?? data.length);
    return {
      items: data.map(mapShowSummary),
      page,
      limit,
      total,
      hasMore: meta?.hasMore ?? page * limit < total,
    };
  }
  const { data, meta } = await apiGet<MovieSummaryDto[]>(`/movies?sort=${sort}&page=${page}&limit=${limit}${languageParam}${genreParam}`);
  const total = Number(meta?.total ?? data.length);
  return {
    items: data.map(mapSummary),
    page,
    limit,
    total,
    hasMore: meta?.hasMore ?? page * limit < total,
  };
}

// The search endpoint's own result shape (id/type/title/poster only) is much thinner than a
// full Movie - MovieCard already renders fine with rating/year absent, so this doesn't do a
// per-result detail fetch just to fill those in on every keystroke.
export async function searchMovies(query: string): Promise<Movie[]> {
  const [catalogResult, movieResult, seriesResult, ceeMovieResult, ceeSeriesResult] = await Promise.allSettled([
    apiGet<SearchResultItemDto[]>(`/search?search=${encodeURIComponent(query)}&limit=30`),
    searchCinemana(query, "movie"),
    searchCinemana(query, "series"),
    searchCee(query, "movie"),
    searchCee(query, "series"),
  ]);
  const catalogItems: Movie[] = catalogResult.status === "fulfilled" ? catalogResult.value.data.map((r) => ({
    id: r.id,
    titleAr: r.titleAr || r.title,
    titleEn: r.title,
    originalTitle: r.originalTitle ?? undefined,
    poster: r.poster ?? undefined,
    type: r.type === "show" ? "series" : "movie",
    rating: r.rating ?? undefined,
    year: r.releaseDate ? new Date(r.releaseDate).getUTCFullYear() : undefined,
    imdbId: extractImdbId(r.imdbId || r.imdbUrlRef),
    partNumber: r.partNumber ?? undefined,
    servers: [],
  })) : [];
  const cinemanaCandidates = [
    ...(movieResult.status === "fulfilled" ? movieResult.value : []),
    ...(seriesResult.status === "fulfilled" ? seriesResult.value : []),
  ];
  const ceeCandidates = [
    ...(ceeMovieResult.status === "fulfilled" ? ceeMovieResult.value : []),
    ...(ceeSeriesResult.status === "fulfilled" ? ceeSeriesResult.value : []),
  ];
  return catalogItems.map((tmdbMovie) => {
    const cached = cinemanaMatchCache.get(tmdbMovie.id);
    const cinemanaMatch = matchTmdbWithCinemana(tmdbMovie, cinemanaCandidates);
    const ceeMatch = matchTmdbWithCinemana(tmdbMovie, ceeCandidates);
    const sources = [
      cached,
      cinemanaMatch?.nb != null ? { provider: "cinemana" as const, cinemanaId: makeCinemanaId(cinemanaMatch.nb), available: true } : null,
      ceeMatch?.nb != null ? { provider: "cee" as const, ceeId: makeCeeId(ceeMatch.nb), available: true } : null,
    ].filter((source): source is PlaybackMapping => !!source);
    if (!sources.length) return tmdbMovie;
    const uniqueSources = sources.filter((source, index, all) => all.findIndex((item) => item.provider === source.provider && item.cinemanaId === source.cinemanaId && item.ceeId === source.ceeId) === index);
    cacheMatch(tmdbMovie.id, uniqueSources[0]);
    return { ...tmdbMovie, playback: uniqueSources[0], playbackSources: uniqueSources, hasPlayableStream: true };
  });
}

// PersonScreen only ever needs the filmography grid (it already has the person's own
// name/photo/bio from whichever movie/show credit the viewer tapped into) - id-based, not
// name-based, since names collide and TMDB ids are the only reliable identity here.
export async function fetchByPerson(personId: string): Promise<Movie[]> {
  const { data } = await apiGet<PersonDetailDto>(`/people/${personId}`);
  return data.filmography.map((c) => ({
    id: c.id,
    titleAr: c.title,
    titleEn: c.title,
    poster: c.poster ?? undefined,
    rating: c.rating ?? undefined,
    year: c.releaseDate ? new Date(c.releaseDate).getUTCFullYear() : undefined,
    type: c.type === "show" ? "series" : "movie",
    servers: [],
  }));
}

export async function fetchCollection(collectionId: string, excludeId: string): Promise<Movie[]> {
  const { data } = await apiGet<MovieSummaryDto[]>(
    `/movies/collection/${collectionId}?exclude=${encodeURIComponent(excludeId)}`,
  );
  return data.map(mapSummary);
}

// Mirrors the web app's getHighResImage bucket-swap logic (src/utils/imageUtils.ts) -
// small rail/grid posters should request w342, not TMDB's full-size original; cast circles
// only ever need TMDB's smallest profile bucket (w185).
export function posterUrl(path?: string, size: "w185" | "w342" | "w780" | "w1280" = "w342"): string {
  if (!path) return "";
  if (path.includes("image.tmdb.org/t/p/")) {
    return path.replace(/\/t\/p\/(w\d+|original)\//, `/t/p/${size}/`);
  }
  return path;
}
