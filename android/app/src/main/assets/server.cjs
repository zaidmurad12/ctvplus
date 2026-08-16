var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_adm_zip = __toESM(require("adm-zip"), 1);
var import_app = require("firebase/app");
var import_firestore = require("firebase/firestore");

// db.ts
var import_better_sqlite3 = __toESM(require("better-sqlite3"), 1);
var import_path = __toESM(require("path"), 1);
var DB_PATH = import_path.default.join(process.cwd(), "cinemana.db");
var _db = null;
function getDb() {
  if (_db) return _db;
  _db = new import_better_sqlite3.default(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      title_ar     TEXT NOT NULL,
      title_en     TEXT NOT NULL,
      year         INTEGER,
      rating       REAL,
      is_published INTEGER NOT NULL DEFAULT 1,
      updated_at   TEXT NOT NULL,
      data         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_movies_type ON movies(type);
    CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
    CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating);
    CREATE INDEX IF NOT EXISTS idx_movies_is_published ON movies(is_published);

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_ids (
      kind  TEXT NOT NULL CHECK(kind IN ('id','title')),
      value TEXT NOT NULL,
      PRIMARY KEY (kind, value)
    );
  `);
  return _db;
}
function loadAllMoviesFromDb() {
  const rows = getDb().prepare("SELECT data FROM movies ORDER BY rowid").all();
  return rows.map((r) => JSON.parse(r.data));
}
function replaceAllMoviesInDb(movies) {
  const db2 = getDb();
  const insertStmt = db2.prepare(`
    INSERT INTO movies (id, type, title_ar, title_en, year, rating, is_published, updated_at, data)
    VALUES (@id, @type, @title_ar, @title_en, @year, @rating, @is_published, @updated_at, @data)
  `);
  const tx = db2.transaction((rows) => {
    db2.prepare("DELETE FROM movies").run();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const m of rows) {
      insertStmt.run({
        id: String(m.id),
        type: m.type ?? "movie",
        title_ar: m.titleAr ?? "",
        title_en: m.titleEn ?? "",
        year: m.year ?? null,
        rating: m.rating ?? null,
        is_published: m.isPublished !== false ? 1 : 0,
        updated_at: now,
        data: JSON.stringify(m)
      });
    }
  });
  tx(movies);
}
var CONFIG_KEYS = ["customHeroId", "customTrendingIds", "customPromos", "adsSettings"];
function loadConfigFromDb() {
  const rows = getDb().prepare("SELECT key, value FROM config").all();
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const parse = (key, fallback) => {
    const raw = byKey.get(key);
    if (raw === void 0) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };
  return {
    customHeroId: parse("customHeroId", null),
    customTrendingIds: parse("customTrendingIds", []),
    customPromos: parse("customPromos", []),
    adsSettings: parse("adsSettings", null)
  };
}
function saveConfigToDb(config) {
  const db2 = getDb();
  const upsertStmt = db2.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
  const tx = db2.transaction(() => {
    for (const key of CONFIG_KEYS) {
      upsertStmt.run(key, JSON.stringify(config[key] ?? null));
    }
  });
  tx();
}
function loadDeletedIdsFromDb() {
  const rows = getDb().prepare("SELECT kind, value FROM deleted_ids").all();
  const ids = [];
  const titles = [];
  for (const row of rows) {
    if (row.kind === "id") ids.push(row.value);
    else titles.push(row.value);
  }
  return { ids, titles };
}
function replaceDeletedIdsInDb(ids, titles) {
  const db2 = getDb();
  const insertStmt = db2.prepare("INSERT OR IGNORE INTO deleted_ids (kind, value) VALUES (?, ?)");
  const tx = db2.transaction(() => {
    db2.prepare("DELETE FROM deleted_ids").run();
    for (const id of ids) insertStmt.run("id", id);
    for (const title of titles) insertStmt.run("title", title);
  });
  tx();
}

// tmdb.ts
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_IMG_BASE = "https://image.tmdb.org/t/p";
function apiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not configured in .env");
  return key;
}
var tmdbQuotaExceededUntil = 0;
var requestChain = Promise.resolve();
var lastRequestAt = 0;
var MIN_GAP_MS = 120;
async function throttledFetch(url) {
  if (Date.now() < tmdbQuotaExceededUntil) {
    throw new Error("TMDB rate limit cooldown active");
  }
  const gate = requestChain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  requestChain = gate.catch(() => {
  });
  await gate;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2e4) });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 10;
        tmdbQuotaExceededUntil = Date.now() + retryAfter * 1e3;
        console.warn(`[TMDB] 429 rate limited \u2014 cooling down for ${retryAfter}s.`);
      }
      return res;
    } catch (err) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
function tmdbUrl(path3, params = {}) {
  const qs = new URLSearchParams({ api_key: apiKey(), ...params }).toString();
  return `${TMDB_BASE}${path3}?${qs}`;
}
async function tmdbGet(path3, params) {
  try {
    const res = await throttledFetch(tmdbUrl(path3, params));
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[TMDB] ${path3} responded ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[TMDB] Request failed for ${path3}:`, err);
    return null;
  }
}
function tmdbImageUrl(path3, size) {
  if (!path3) return null;
  return `${TMDB_IMG_BASE}/${size}${path3.startsWith("/") ? path3 : "/" + path3}`;
}
var posterUrl = (path3) => tmdbImageUrl(path3, "w780");
var backdropUrl = (path3) => tmdbImageUrl(path3, "original");
var profileUrl = (path3) => tmdbImageUrl(path3, "w185");
var logoUrl = (path3) => tmdbImageUrl(path3, "w500");
async function searchMulti(query) {
  const data = await tmdbGet("/search/multi", { query, include_adult: "false" });
  const hit = data?.results?.find((r) => r.media_type === "movie" || r.media_type === "tv");
  if (!hit) return null;
  return { id: hit.id, mediaType: hit.media_type };
}
async function searchPerson(name) {
  const data = await tmdbGet("/search/person", { query: name });
  const hit = data?.results?.[0];
  if (!hit) return null;
  return { id: hit.id, profilePath: hit.profile_path ?? null };
}
async function findByImdbId(imdbId) {
  const data = await tmdbGet(`/find/${imdbId}`, { external_source: "imdb_id" });
  const movieHit = data?.movie_results?.[0];
  if (movieHit) return { id: movieHit.id, mediaType: "movie" };
  const tvHit = data?.tv_results?.[0];
  if (tvHit) return { id: tvHit.id, mediaType: "tv" };
  return null;
}
var MOVIE_APPEND = "credits,images,videos,translations,release_dates";
var TV_APPEND = "credits,images,videos,translations,content_ratings,external_ids";
var IMAGE_LANGS = "en,ar,null";
async function getMovieDetails(id) {
  return tmdbGet(`/movie/${id}`, {
    language: "en-US",
    append_to_response: MOVIE_APPEND,
    include_image_language: IMAGE_LANGS
  });
}
async function getMovieArabic(id) {
  return tmdbGet(`/movie/${id}`, { language: "ar" });
}
async function getTvDetails(id) {
  return tmdbGet(`/tv/${id}`, {
    language: "en-US",
    append_to_response: TV_APPEND,
    include_image_language: IMAGE_LANGS
  });
}
async function getTvArabic(id) {
  return tmdbGet(`/tv/${id}`, { language: "ar" });
}
async function getTvSeasonDetails(tvId, seasonNumber, language = "en-US") {
  return tmdbGet(`/tv/${tvId}/season/${seasonNumber}`, { language });
}
async function getCollectionDetails(collectionId, language = "en-US") {
  return tmdbGet(`/collection/${collectionId}`, { language });
}
var TRENDING_ENDPOINTS = [
  { path: "/trending/movie/week", mediaType: "movie" },
  { path: "/trending/tv/week", mediaType: "tv" },
  { path: "/movie/top_rated", mediaType: "movie" },
  { path: "/movie/now_playing", mediaType: "movie" },
  { path: "/movie/upcoming", mediaType: "movie" },
  { path: "/tv/top_rated", mediaType: "tv" },
  { path: "/tv/on_the_air", mediaType: "tv" },
  { path: "/tv/popular", mediaType: "tv" }
];
async function getTrendingPaths() {
  const paths = /* @__PURE__ */ new Set();
  for (const endpoint of TRENDING_ENDPOINTS) {
    const data = await tmdbGet(endpoint.path);
    for (const item of data?.results ?? []) {
      if (item?.id) paths.add(`/${endpoint.mediaType}/${item.id}`);
    }
  }
  return Array.from(paths);
}

// server.ts
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT) || 3e3;
app.use(import_express.default.json({ limit: "50mb" }));
var db = null;
try {
  const firebaseConfigPath = import_path2.default.join(process.cwd(), "firebase-applet-config.json");
  if (import_fs.default.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(import_fs.default.readFileSync(firebaseConfigPath, "utf8"));
    const firebaseApp = (0, import_app.initializeApp)(firebaseConfig);
    db = (0, import_firestore.getFirestore)(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("[Server] Firebase/Firestore successfully initialized using project:", firebaseConfig.projectId);
  } else {
    console.warn("[Server] firebase-applet-config.json not found. Firebase is uninitialized.");
  }
} catch (fbErr) {
  console.error("[Server] Error initializing Firebase:", fbErr);
}
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});
var geminiApiKey = process.env.GEMINI_API_KEY;
var ai = null;
if (geminiApiKey) {
  ai = new import_genai.GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
var quotaExceededUntil = 0;
function handleGeminiError(error, contextName) {
  const errMsg = String(error?.message || error);
  if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
    quotaExceededUntil = Date.now() + 15 * 60 * 1e3;
    console.warn(`[Gemini Rate Limit] Quota limit hit in ${contextName}. Pausing all Gemini queries for 15 minutes.`);
  }
}
var MOVIES_DB_PATH = import_path2.default.join(process.cwd(), "movies_db.json");
var CONFIG_PATH = import_path2.default.join(process.cwd(), "config.json");
var customHeroId = null;
var customTrendingIds = [];
var customPromos = [];
var defaultAdsSettings = {
  enabled: false,
  globalSkipAfterSeconds: 5,
  allowSkip: true,
  ads: [
    {
      id: "ad_demo_1",
      titleAr: "\u0625\u0639\u0644\u0627\u0646 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0639\u0631\u0636 \u0627\u0644\u0630\u0647\u0628\u064A 4K",
      titleEn: "Cinemana Golden Premiere 4K Ad",
      sponsorNameAr: "\u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u062A\u064A \u0641\u064A \u0628\u0631\u0648",
      sponsorNameEn: "Cinemana TV Pro",
      sponsorLogo: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=200&q=80",
      sponsorUrl: "https://cinemana.tv",
      skipAfterSeconds: 5,
      durationSeconds: 15,
      isActive: true,
      targetType: "all",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      servers: [
        { id: "ad_srv_1", name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u0627\u0644\u0631\u0626\u064A\u0633\u064A (MP4 Direct 1080p)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", type: "video" },
        { id: "ad_srv_2", name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0625\u0639\u0644\u0627\u0646 \u0627\u0644\u0633\u0631\u064A\u0639 (MP4 4K)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4", type: "video" },
        { id: "ad_srv_3", name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0625\u062D\u062A\u064A\u0627\u0637\u064A (HLS Stream)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls" }
      ]
    },
    {
      id: "ad_demo_2",
      titleAr: "\u0625\u0639\u0644\u0627\u0646 \u0631\u0627\u0639\u064A \u0627\u0644\u0628\u062B \u0648\u0627\u0644\u062A\u063A\u0637\u064A\u0629 \u0627\u0644\u062D\u0635\u0631\u064A\u0629",
      titleEn: "Exclusive Broadcast Sponsor Ad",
      sponsorNameAr: "\u0627\u0644\u0631\u0627\u0639\u064A \u0627\u0644\u0631\u0633\u0645\u064A \u0644\u0644\u0641\u064A\u0644\u0645",
      sponsorNameEn: "Official Sponsor",
      sponsorLogo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&q=80",
      sponsorUrl: "https://google.com",
      skipAfterSeconds: 5,
      durationSeconds: 12,
      isActive: true,
      targetType: "all",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      servers: [
        { id: "ad_srv_2_1", name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A \u0644\u0644\u0625\u0639\u0644\u0627\u0646 \u0627\u0644\u062B\u0627\u0646\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoypasses.mp4", type: "video" },
        { id: "ad_srv_2_2", name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0628\u062F\u064A\u0644", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4", type: "video" }
      ]
    }
  ]
};
var adsSettings = JSON.parse(JSON.stringify(defaultAdsSettings));
var defaultPromos = [
  {
    id: "promo_1",
    titleAr: "\u0648\u0644\u0627\u062F \u0631\u0632\u0642 3: \u0627\u0644\u0642\u0627\u0636\u064A\u0629",
    titleEn: "Welad Rizk 3: The Knockout",
    tagAr: "\u0639\u0631\u0636 \u0623\u0648\u0644 \u062D\u0635\u0631\u064A",
    tagEn: "Exclusive Premiere",
    descriptionAr: "\u0641\u064A\u0644\u0645 \u0627\u0644\u0623\u0643\u0634\u0646 \u0648\u0627\u0644\u062A\u0634\u0648\u064A\u0642 \u0627\u0644\u0639\u0631\u0628\u064A \u0627\u0644\u0623\u0643\u062B\u0631 \u0634\u0639\u0628\u064A\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0627\u0645 \u0645\u062A\u0648\u0641\u0631 \u0627\u0644\u0622\u0646 \u0644\u0644\u0628\u062B \u0627\u0644\u0641\u0648\u0631\u064A \u0628\u062C\u0648\u062F\u0629 Ultra HD 4K \u0641\u0627\u0626\u0642\u0629 \u0627\u0644\u0633\u0631\u0639\u0629.",
    descriptionEn: "The highly anticipated Arabic blockbuster is now streaming in stunning Ultra HD 4K directly on Cinemana.",
    image: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&q=80",
    actionType: "search",
    actionValue: "\u0648\u0644\u0627\u062F \u0631\u0632\u0642"
  },
  {
    id: "promo_2",
    titleAr: "\u0635\u0631\u0627\u0639 \u0627\u0644\u0639\u0631\u0648\u0634: \u0622\u0644 \u0627\u0644\u062A\u0646\u064A\u0646",
    titleEn: "House of the Dragon - S2",
    tagAr: "\u062D\u0644\u0642\u0627\u062A \u062C\u062F\u064A\u062F\u0629 \u0645\u0636\u0627\u0641\u0629",
    tagEn: "New Episodes Added",
    descriptionAr: "\u0634\u0627\u0647\u062F \u0627\u0644\u0645\u0639\u0627\u0631\u0643 \u0627\u0644\u0645\u0644\u062D\u0645\u064A\u0629 \u0648\u0627\u0644\u062A\u0646\u0627\u0646\u064A\u0646 \u0641\u064A \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u062B\u0627\u0646\u064A \u0627\u0644\u062C\u062F\u064A\u062F \u0643\u0644\u064A\u0627\u064B. \u062D\u0644\u0642\u0627\u062A \u062C\u062F\u064A\u062F\u0629 \u062A\u0636\u0627\u0641 \u0623\u0633\u0628\u0648\u0639\u064A\u0627\u064B \u0628\u062C\u0648\u062F\u0629 Full HD.",
    descriptionEn: "Watch the epic battles and dragons in the all-new Season 2. New episodes added weekly in Full HD.",
    image: "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=1200&q=80",
    actionType: "play",
    actionValue: "series_1"
  },
  {
    id: "promo_3",
    titleAr: "\u0628\u0627\u0642\u0629 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 VIP \u0627\u0644\u0645\u0645\u064A\u0632\u0629",
    titleEn: "Cinemana VIP Premium Channels",
    tagAr: "\u0645\u064A\u0632\u0629 \u0627\u0644\u0628\u062B \u0627\u0644\u0645\u0628\u0627\u0634\u0631",
    tagEn: "Live TV Feature",
    descriptionAr: "\u0628\u062B \u0645\u0628\u0627\u0634\u0631 \u0645\u062C\u0627\u0646\u064A \u0628\u062F\u0648\u0646 \u0641\u0648\u0627\u0635\u0644 \u0625\u0639\u0644\u0627\u0646\u064A\u0629 \u0644\u062C\u0645\u064A\u0639 \u0642\u0646\u0648\u0627\u062A \u0627\u0644\u0645\u0628\u0627\u0631\u064A\u0627\u062A \u0648\u0627\u0644\u0631\u064A\u0627\u0636\u0629 \u0648\u0627\u0644\u062A\u0631\u0641\u064A\u0647 \u0645\u0628\u0627\u0634\u0631\u0629 \u062F\u0627\u062E\u0644 \u062A\u0637\u0628\u064A\u0642\u0643 \u0627\u0644\u0645\u0641\u0636\u0644.",
    descriptionEn: "Free live streams of sports, matches, and premier entertainment channels with zero ads directly inside your app.",
    image: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200&q=80",
    actionType: "settings",
    actionValue: "vip"
  }
];
function saveMoviesDatabase() {
  try {
    replaceAllMoviesInDb(moviesDatabase);
  } catch (error) {
    console.error("[Server] Error saving movies to SQLite:", error);
  }
  try {
    const dataStr = JSON.stringify(moviesDatabase, null, 2);
    import_fs.default.writeFileSync(MOVIES_DB_PATH, dataStr, "utf8");
    try {
      const publicPath = import_path2.default.join(process.cwd(), "public", "movies.json");
      if (import_fs.default.existsSync(import_path2.default.dirname(publicPath))) import_fs.default.writeFileSync(publicPath, dataStr, "utf8");
      const distPath = import_path2.default.join(process.cwd(), "dist", "movies.json");
      if (import_fs.default.existsSync(import_path2.default.dirname(distPath))) import_fs.default.writeFileSync(distPath, dataStr, "utf8");
      const androidAssetsPath = import_path2.default.join(process.cwd(), "android", "app", "src", "main", "assets", "movies.json");
      if (import_fs.default.existsSync(import_path2.default.dirname(androidAssetsPath))) import_fs.default.writeFileSync(androidAssetsPath, dataStr, "utf8");
    } catch (_e) {
    }
    cachedHomeData = null;
    subtitlesCache.clear();
  } catch (error) {
    console.error("[Server] Error saving movies database:", error);
  }
}
function getRealStreamingServers(item, seasonNumber, episodeNumber) {
  const cleanId = item.id.replace(/\D/g, "");
  if (cleanId) {
    if (seasonNumber !== void 0 && episodeNumber !== void 0) {
      return [
        { name: "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631", url: `https://video.shabakaty.com/movies/${cleanId}/${seasonNumber}/${episodeNumber}/index.m3u8` }
      ];
    } else {
      return [
        { name: "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631", url: `https://video.shabakaty.com/movies/${cleanId}/index.m3u8` }
      ];
    }
  }
  const samples = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
  ];
  const str = `${item.id}_${seasonNumber || ""}_${episodeNumber || ""}_${item.titleEn}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % samples.length;
  return [
    { name: "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: samples[idx] }
  ];
}
var isPlaceholderServer = (servers) => {
  if (!servers || servers.length === 0) return true;
  const url = servers[0].url;
  return url.includes("commondatastorage.googleapis.com") || url.includes("mov_bbb.mp4") || url.includes("example.com") || url.includes("w3schools.com");
};
function enrichMovieMetadata(movie) {
  if (!movie) return;
  const isFakeAr = !movie.subtitlesUrlAr || movie.subtitlesUrlAr.includes("example.com");
  const isMismatchedAr = !!movie.subtitlesUrlAr?.startsWith("/api/subtitles?") && !movie.subtitlesUrlAr.includes(`movieId=${movie.id}&`);
  if (isFakeAr || isMismatchedAr) {
    movie.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&lang=ar`;
  }
  const isFakeEn = !movie.subtitlesUrlEn || movie.subtitlesUrlEn.includes("example.com");
  const isMismatchedEn = !!movie.subtitlesUrlEn?.startsWith("/api/subtitles?") && !movie.subtitlesUrlEn.includes(`movieId=${movie.id}&`);
  if (isFakeEn || isMismatchedEn) {
    movie.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&lang=en`;
  }
  if (!movie.servers || movie.servers.length === 0 || isPlaceholderServer(movie.servers)) {
    movie.servers = getRealStreamingServers(movie);
  }
  if (movie.type === "series" && movie.seasons) {
    movie.seasons.forEach((season, sIdx) => {
      if (season.episodes) {
        season.episodes.forEach((episode) => {
          const epIdMatch = `movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&`;
          const isEpFakeAr = !episode.subtitlesUrlAr || episode.subtitlesUrlAr.includes("example.com");
          const isEpMismatchedAr = !!episode.subtitlesUrlAr?.startsWith("/api/subtitles?") && !episode.subtitlesUrlAr.includes(epIdMatch);
          if (isEpFakeAr || isEpMismatchedAr) {
            episode.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&lang=ar`;
          }
          const isEpFakeEn = !episode.subtitlesUrlEn || episode.subtitlesUrlEn.includes("example.com");
          const isEpMismatchedEn = !!episode.subtitlesUrlEn?.startsWith("/api/subtitles?") && !episode.subtitlesUrlEn.includes(epIdMatch);
          if (isEpFakeEn || isEpMismatchedEn) {
            episode.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&lang=en`;
          }
          if (!episode.servers || episode.servers.length === 0 || isPlaceholderServer(episode.servers)) {
            episode.servers = getRealStreamingServers(movie, season.number || sIdx + 1, episode.number);
          }
        });
      }
    });
  }
}
var deletedMovieIds = /* @__PURE__ */ new Set();
var deletedMovieTitles = /* @__PURE__ */ new Set();
var DELETED_IDS_PATH = import_path2.default.join(process.cwd(), "deleted_ids.json");
function loadDeletedMovieIds() {
  try {
    const { ids, titles } = loadDeletedIdsFromDb();
    ids.forEach((id) => deletedMovieIds.add(id));
    titles.forEach((t) => deletedMovieTitles.add(t.toLowerCase().trim()));
    console.log(`[Server] Loaded ${deletedMovieIds.size} deleted movie IDs and ${deletedMovieTitles.size} deleted movie titles from SQLite.`);
  } catch (err) {
    console.error("[Server] Error loading deleted ids from SQLite:", err);
  }
}
function saveDeletedMovieIds() {
  try {
    replaceDeletedIdsInDb(deletedMovieIds, deletedMovieTitles);
  } catch (err) {
    console.error("[Server] Error saving deleted ids to SQLite:", err);
  }
  try {
    const payload = {
      ids: Array.from(deletedMovieIds),
      titles: Array.from(deletedMovieTitles)
    };
    import_fs.default.writeFileSync(DELETED_IDS_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.error("[Server] Error saving deleted_ids.json:", err);
  }
}
function isMovieDeleted(id, titleAr, titleEn) {
  if (id && deletedMovieIds.has(id)) return true;
  if (titleAr && deletedMovieTitles.has(titleAr.toLowerCase().trim())) return true;
  if (titleEn && deletedMovieTitles.has(titleEn.toLowerCase().trim())) return true;
  return false;
}
function markMovieAsDeleted(movie) {
  if (movie.id) deletedMovieIds.add(movie.id);
  if (movie.titleAr) deletedMovieTitles.add(movie.titleAr.toLowerCase().trim());
  if (movie.titleEn) deletedMovieTitles.add(movie.titleEn.toLowerCase().trim());
  saveDeletedMovieIds();
}
function unmarkMovieAsDeleted(id, titleAr, titleEn) {
  if (id) deletedMovieIds.delete(id);
  if (titleAr) deletedMovieTitles.delete(titleAr.toLowerCase().trim());
  if (titleEn) deletedMovieTitles.delete(titleEn.toLowerCase().trim());
  saveDeletedMovieIds();
}
function saveConfig() {
  saveDeletedMovieIds();
  const config = {
    customHeroId,
    customTrendingIds,
    customPromos,
    adsSettings
  };
  try {
    saveConfigToDb(config);
  } catch (error) {
    console.error("[Server] Error saving config to SQLite:", error);
  }
  try {
    import_fs.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (error) {
    console.error("[Server] Error saving config:", error);
  }
}
async function saveMovieToFirestore(movie) {
  if (!db) return;
  try {
    const movieRef = (0, import_firestore.doc)(db, "movies", movie.id);
    const cleanMovie = JSON.parse(JSON.stringify(movie));
    await (0, import_firestore.setDoc)(movieRef, cleanMovie);
    console.log(`[Firestore] Successfully saved movie ${movie.id}`);
  } catch (err) {
    console.error(`[Firestore] Error saving movie ${movie.id} to Firestore:`, err);
  }
}
async function deleteMovieFromFirestore(id) {
  if (!db) return;
  try {
    const movieRef = (0, import_firestore.doc)(db, "movies", id);
    await (0, import_firestore.deleteDoc)(movieRef);
    console.log(`[Firestore] Successfully deleted movie ${id}`);
  } catch (err) {
    console.error(`[Firestore] Error deleting movie ${id} from Firestore:`, err);
  }
}
async function saveConfigToFirestore() {
  if (!db) return;
  try {
    const configRef = (0, import_firestore.doc)(db, "config", "main_config");
    await (0, import_firestore.setDoc)(configRef, {
      customHeroId,
      customTrendingIds,
      customPromos,
      adsSettings,
      deletedMovieIds: Array.from(deletedMovieIds),
      deletedMovieTitles: Array.from(deletedMovieTitles)
    });
    console.log("[Firestore] Successfully saved global config to Firestore");
  } catch (err) {
    console.error("[Firestore] Error saving config to Firestore:", err);
  }
}
var moviesDatabase = [
  {
    id: "movie_1",
    titleAr: "\u0643\u062B\u0628\u0627\u0646: \u0627\u0644\u062C\u0632\u0621 \u0627\u0644\u062B\u0627\u0646\u064A",
    titleEn: "Dune: Part Two",
    type: "movie",
    rating: 8.8,
    year: 2024,
    duration: "2h 46m",
    genres: ["\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A", "\u0645\u063A\u0627\u0645\u0631\u0629", "\u062F\u0631\u0627\u0645\u0627"],
    poster: "https://image.tmdb.org/t/p/w500/1pdf7ZgTCg7g0RLv6V2mX6CDmrl.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xOMoCO8v68vnsHOWDvStgGN67Hl.jpg",
    storyAr: "\u064A\u062A\u0627\u0628\u0639 \u0628\u0648\u0644 \u0623\u062A\u0631\u064A\u062F\u0633 \u0631\u062D\u0644\u062A\u0647 \u0627\u0644\u0623\u0633\u0637\u0648\u0631\u064A\u0629 \u0628\u064A\u0646\u0645\u0627 \u064A\u062A\u062D\u062F \u0645\u0639 \u0634\u0627\u0646\u064A \u0648\u0627\u0644\u0641\u0631\u0645\u0646 \u0641\u064A \u0637\u0631\u064A\u0642 \u0627\u0644\u0627\u0646\u062A\u0642\u0627\u0645 \u0645\u0646 \u0627\u0644\u0645\u062A\u0622\u0645\u0631\u064A\u0646 \u0627\u0644\u0630\u064A\u0646 \u062F\u0645\u0631\u0648\u0627 \u0639\u0627\u0626\u0644\u062A\u0647. \u0648\u0641\u064A \u0645\u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0628\u064A\u0646 \u062D\u0628 \u062D\u064A\u0627\u062A\u0647 \u0648\u0645\u0635\u064A\u0631 \u0627\u0644\u0643\u0648\u0646 \u0627\u0644\u0645\u0639\u0631\u0648\u0641\u060C \u064A\u0633\u0639\u0649 \u062C\u0627\u0647\u062F\u0627\u064B \u0644\u0645\u0646\u0639 \u0645\u0633\u062A\u0642\u0628\u0644 \u0645\u0631\u0639\u0628 \u0644\u0627 \u064A\u0633\u062A\u0637\u064A\u0639 \u0627\u0644\u062A\u0646\u0628\u0624 \u0628\u0647 \u0625\u0644\u0627 \u0647\u0648.",
    storyEn: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe, he endeavors to prevent a terrible future only he can foresee.",
    actors: ["\u062A\u064A\u0645\u0648\u062B\u064A \u0634\u0627\u0644\u0627\u0645\u0627\u064A", "\u0632\u064A\u0646\u062F\u0627\u064A\u0627", "Rebecca Ferguson", "\u062E\u0627\u0641\u064A\u064A\u0631 \u0628\u0627\u0631\u062F\u064A\u0645"],
    director: "Denis Villeneuve",
    writer: "Jon Spaihts",
    quality: "Ultra HD",
    servers: [
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0634\u0628\u0643\u062A\u064A HD", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0631\u0626\u064A\u0633\u064A 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0633\u0631\u064A\u0639 SD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" }
    ]
  },
  {
    id: "movie_2",
    titleAr: "\u0623\u0648\u0628\u0646\u0647\u0627\u064A\u0645\u0631",
    titleEn: "Oppenheimer",
    type: "movie",
    rating: 8.9,
    year: 2023,
    duration: "3h 00m",
    genres: ["\u0633\u064A\u0631\u0629 \u0630\u0627\u062A\u064A\u0629", "\u062F\u0631\u0627\u0645\u0627", "\u062A\u0627\u0631\u064A\u062E\u064A"],
    poster: "https://image.tmdb.org/t/p/w500/8Gxv2gSjdh4RH76v88VMj7xD26m.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/fm6a0A612Yg7jIIOWCO367YQO0Z.jpg",
    storyAr: "\u0642\u0635\u0629 \u0627\u0644\u0641\u064A\u0632\u064A\u0627\u0626\u064A \u0627\u0644\u0623\u0645\u0631\u064A\u0643\u064A \u062C\u064A\u0647. \u0631\u0648\u0628\u0631\u062A \u0623\u0648\u0628\u0646\u0647\u0627\u064A\u0645\u0631 \u0648\u062F\u0648\u0631\u0647 \u0627\u0644\u0642\u064A\u0627\u062F\u064A \u0641\u064A \u062A\u0637\u0648\u064A\u0631 \u0627\u0644\u0642\u0646\u0628\u0644\u0629 \u0627\u0644\u0630\u0631\u064A\u0629 \u062E\u0644\u0627\u0644 \u0627\u0644\u062D\u0631\u0628 \u0627\u0644\u0639\u0627\u0644\u0645\u064A\u0629 \u0627\u0644\u062B\u0627\u0646\u064A\u0629 \u0641\u064A \u0645\u0634\u0631\u0648\u0639 \u0645\u0627\u0646\u0647\u0627\u062A\u0646 \u0627\u0644\u0633\u0631\u064A.",
    storyEn: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
    actors: ["\u0643\u064A\u0644\u064A\u0627\u0646 \u0645\u0648\u0631\u0641\u064A", "\u0625\u0645\u064A\u0644\u064A \u0628\u0644\u0627\u0646\u062A", "\u0631\u0648\u0628\u0631\u062A \u062F\u0627\u0648\u0646\u064A \u062C\u0648\u0646\u064A\u0648\u0631", "\u0645\u0627\u062A \u062F\u064A\u0645\u0648\u0646"],
    director: "Christopher Nolan",
    writer: "Christopher Nolan",
    quality: "Full HD",
    servers: [
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0634\u0628\u0643\u062A\u064A HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
      { name: "\u0633\u064A\u0631\u0641\u0631 \u062E\u0627\u0631\u062C\u064A 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
    ]
  },
  {
    id: "movie_3",
    titleAr: "\u0633\u0628\u0627\u064A\u062F\u0631\u0645\u0627\u0646: \u0639\u0628\u0631 \u0639\u0627\u0644\u0645 \u0627\u0644\u0639\u0646\u0643\u0628\u0648\u062A",
    titleEn: "Spider-Man: Across the Spider-Verse",
    type: "movie",
    rating: 8.7,
    year: 2023,
    duration: "2h 20m",
    genres: ["\u0631\u0633\u0648\u0645 \u0645\u062A\u062D\u0631\u0643\u0629", "\u0623\u0643\u0634\u0646", "\u0645\u063A\u0627\u0645\u0631\u0629"],
    poster: "https://image.tmdb.org/t/p/w500/8vt6mAwv8vN3C6vN6fLV204vWuO.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/gVJ0607v6aUjllKAgTKKpYg56RS.jpg",
    storyAr: "\u064A\u0646\u0637\u0644\u0642 \u0645\u0627\u064A\u0644\u0632 \u0645\u0648\u0631\u0627\u0644\u064A\u0633 \u0639\u0628\u0631 \u0627\u0644\u0639\u0648\u0627\u0644\u0645 \u0627\u0644\u0645\u062A\u0648\u0627\u0632\u064A\u0629\u060C \u062D\u064A\u062B \u064A\u0644\u062A\u0642\u064A \u0628\u0641\u0631\u064A\u0642 \u0645\u0646 '\u0627\u0644\u0639\u0646\u0627\u0643\u0628' \u0627\u0644\u0645\u0643\u0644\u0641\u064A\u0646 \u0628\u062D\u0645\u0627\u064A\u0629 \u0648\u062C\u0648\u062F \u0627\u0644\u0643\u0648\u0646 \u0627\u0644\u0645\u062A\u0639\u062F\u062F. \u0648\u0644\u0643\u0646 \u0639\u0646\u062F\u0645\u0627 \u064A\u062E\u062A\u0644\u0641 \u0627\u0644\u0623\u0628\u0637\u0627\u0644 \u062D\u0648\u0644 \u0643\u064A\u0641\u064A\u0629 \u0627\u0644\u062A\u0639\u0627\u0645\u0644 \u0645\u0639 \u062A\u0647\u062F\u064A\u062F \u062C\u062F\u064A\u062F\u060C \u064A\u062C\u062F \u0645\u0627\u064A\u0644\u0632 \u0646\u0641\u0633\u0647 \u0641\u064A \u0645\u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0639\u0646\u0627\u0643\u0628 \u0627\u0644\u0623\u062E\u0631\u0649.",
    storyEn: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence. When the heroes clash on how to handle a new threat, Miles must redefine what it means to be a hero.",
    actors: ["\u0634\u0627\u0645\u064A\u0643 \u0645\u0648\u0631", "\u0647\u064A\u0644\u064A \u0633\u062A\u0627\u064A\u0646\u0641\u064A\u0644\u062F", "\u0623\u0648\u0633\u0643\u0627\u0631 \u0625\u0633\u062D\u0627\u0642", "Jake Johnson"],
    director: "Joaquim Dos Santos",
    writer: "Phil Lord",
    quality: "Full HD",
    servers: [
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u062D\u062A\u064A\u0627\u0637\u064A HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4" }
    ]
  },
  {
    id: "series_1",
    titleAr: "\u0628\u064A\u062A \u0627\u0644\u062A\u0646\u064A\u0646: \u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u062B\u0627\u0646\u064A",
    titleEn: "House of the Dragon: S2",
    type: "series",
    rating: 8.6,
    year: 2024,
    duration: "8 \u062D\u0644\u0642\u0627\u062A",
    genres: ["\u062E\u064A\u0627\u0644", "\u062F\u0631\u0627\u0645\u0627", "\u062D\u0631\u0628"],
    poster: "https://image.tmdb.org/t/p/w500/1XS16gYbe1b6pH9Yf6ZorR9gK7A.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/et8Zd6gYbe1b6pH9Yf6ZorR9gK7A.jpg",
    storyAr: "\u062A\u0628\u062F\u0623 \u0627\u0644\u062D\u0631\u0628 \u0627\u0644\u0623\u0647\u0644\u064A\u0629 \u0641\u064A \u0639\u0627\u0626\u0644\u0629 \u062A\u0627\u0631\u062C\u0627\u0631\u064A\u064A\u0646 (\u0631\u0642\u0635\u0629 \u0627\u0644\u062A\u0646\u0627\u0646\u064A\u0646) \u0628\u0639\u062F \u0648\u0641\u0627\u0629 \u0627\u0644\u0645\u0644\u0643 \u0641\u064A\u0633\u064A\u0631\u064A\u0633\u060C \u062D\u064A\u062B \u064A\u062A\u0646\u0627\u0641\u0633 \u0627\u0644\u0645\u062C\u0644\u0633 \u0627\u0644\u0623\u062E\u0636\u0631 \u0627\u0644\u0645\u0624\u064A\u062F \u0644\u0625\u064A\u062C\u0648\u0646\u060C \u0648\u0627\u0644\u0645\u062C\u0644\u0633 \u0627\u0644\u0623\u0633\u0648\u062F \u0627\u0644\u0645\u0624\u064A\u062F \u0644\u0631\u064A\u0646\u064A\u0631\u0627 \u0639\u0644\u0649 \u0627\u0644\u062C\u0644\u0648\u0633 \u0639\u0644\u0649 \u0627\u0644\u0639\u0631\u0634 \u0627\u0644\u062D\u062F\u064A\u062F\u064A.",
    storyEn: "The Targaryen civil war begins. Following King Viserys's death, the Green Council (supporting Aegon) and the Black Council (supporting Rhaenyra) fight for control of the Iron Throne.",
    actors: ["\u0625\u064A\u0645\u0627 \u062F\u0622\u0631\u0633\u064A", "\u0645\u0627\u062A \u0633\u0645\u064A\u062B", "\u0623\u0648\u0644\u064A\u0641\u064A\u0627 \u0643\u0648\u0643", "\u0631\u064A\u0633 \u0625\u064A\u0641\u0627\u0646\u0632"],
    director: "Clare Kilner",
    writer: "George R.R. Martin",
    quality: "Ultra HD",
    servers: [
      { name: "\u0627\u0644\u062D\u0644\u0642\u0629 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4" },
      { name: "\u0627\u0644\u062D\u0644\u0642\u0629 2 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4" },
      { name: "\u0627\u0644\u062D\u0644\u0642\u0629 3 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4" }
    ]
  },
  {
    id: "series_2",
    titleAr: "\u0627\u0644\u062D\u0634\u0627\u0634\u064A\u0646",
    titleEn: "The Assassins",
    type: "series",
    rating: 8.4,
    year: 2024,
    duration: "30 \u062D\u0644\u0642\u0629",
    genres: ["\u062A\u0627\u0631\u064A\u062E\u064A", "\u062F\u0631\u0627\u0645\u0627", "\u0633\u064A\u0631\u0629 \u0630\u0627\u062A\u064A\u0629"],
    poster: "https://image.tmdb.org/t/p/w500/mXf53hQfOofU52wR81a28a2g5Nf.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/7COx12A9E58N6S2g5NeF06a28aS.jpg",
    storyAr: "\u064A\u062A\u0646\u0627\u0648\u0644 \u0627\u0644\u0645\u0633\u0644\u0633\u0644 \u0627\u0644\u0633\u064A\u0631\u0629 \u0627\u0644\u062A\u0627\u0631\u064A\u062E\u064A\u0629 \u0644\u0641\u0631\u0642\u0629 \u0627\u0644\u062D\u0634\u0627\u0634\u064A\u0646 \u0648\u0642\u0627\u0626\u062F\u0647\u0627 \u062D\u0633\u0646 \u0627\u0644\u0635\u0628\u0627\u062D\u060C \u0627\u0644\u0645\u0644\u0642\u0628 \u0628\u0627\u0644\u0633\u064A\u062F \u0623\u0648 \u0634\u064A\u062E \u0627\u0644\u062C\u0628\u0644\u060C \u0627\u0644\u0630\u064A \u0623\u0633\u0633 \u0648\u0627\u062D\u062F\u0629 \u0645\u0646 \u0623\u0643\u062B\u0631 \u0627\u0644\u062C\u0645\u0627\u0639\u0627\u062A \u0627\u0644\u0639\u0633\u0643\u0631\u064A\u0629 \u062A\u0631\u0648\u064A\u0639\u0627\u064B \u0641\u064A \u0627\u0644\u0642\u0631\u0646 \u0627\u0644\u062D\u0627\u062F\u064A \u0639\u0634\u0631 \u062F\u0627\u062E\u0644 \u0642\u0644\u0639\u0629 \u0623\u0644\u0645\u0648\u062A.",
    storyEn: "A historical series depicting Hassan-i Sabbah, the founder of the Order of Assassins, and the terrifying group based at Alamut Castle in the 11th century.",
    actors: ["\u0643\u0631\u064A\u0645 \u0639\u0628\u062F \u0627\u0644\u0639\u0632\u064A\u0632", "\u0641\u062A\u062D\u064A \u0639\u0628\u062F \u0627\u0644\u0648\u0647\u0627\u0628", "\u0645\u064A\u0631\u0646\u0627 \u0646\u0648\u0631 \u0627\u0644\u062F\u064A\u0646", "\u0646\u064A\u0642\u0648\u0644\u0627 \u0645\u0639\u0648\u0636"],
    director: "\u0628\u064A\u062A\u0631 \u0645\u064A\u0645\u064A",
    writer: "\u0639\u0628\u062F \u0627\u0644\u0631\u062D\u064A\u0645 \u0643\u0645\u0627\u0644",
    quality: "Full HD",
    servers: [
      { name: "\u0627\u0644\u062D\u0644\u0642\u0629 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" },
      { name: "\u0627\u0644\u062D\u0644\u0642\u0629 2 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4" }
    ]
  },
  {
    id: "movie_4",
    titleAr: "\u0628\u0627\u062A\u0645\u0627\u0646",
    titleEn: "The Batman",
    type: "movie",
    rating: 8.2,
    year: 2022,
    duration: "2h 56m",
    genres: ["\u0623\u0643\u0634\u0646", "\u062C\u0631\u064A\u0645\u0629", "\u062F\u0631\u0627\u0645\u0627"],
    poster: "https://image.tmdb.org/t/p/w500/74xTEgt7R36P6C90v68779g987a.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/b0Plj7R36P6C90v68779g987a.jpg",
    storyAr: "\u0639\u0646\u062F\u0645\u0627 \u064A\u0642\u062A\u0644 \u0642\u0627\u062A\u0644 \u0645\u062A\u0633\u0644\u0633\u0644 \u0633\u0627\u062F\u064A \u0633\u0644\u0633\u0644\u0629 \u0645\u0646 \u0627\u0644\u0634\u062E\u0635\u064A\u0627\u062A \u0627\u0644\u0633\u064A\u0627\u0633\u064A\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0641\u064A \u063A\u0648\u062B\u0627\u0645\u060C \u064A\u0636\u0637\u0631 \u0628\u0627\u062A\u0645\u0627\u0646 \u0625\u0644\u0649 \u0627\u0644\u062A\u062D\u0642\u064A\u0642 \u0641\u064A \u0627\u0644\u0641\u0633\u0627\u062F \u0627\u0644\u0645\u0633\u062A\u062A\u0631 \u0641\u064A \u0627\u0644\u0645\u062F\u064A\u0646\u0629 \u0648\u0645\u0633\u0627\u0621\u0644\u0629 \u0627\u0644\u062A\u0632\u0627\u0645 \u0639\u0627\u0626\u0644\u062A\u0647.",
    storyEn: "When a sadistic serial killer begins murdering key political figures in Gotham, Batman is forced to investigate the city's hidden corruption and question his family's involvement.",
    actors: ["\u0631\u0648\u0628\u0631\u062A \u0628\u0627\u062A\u064A\u0646\u0633\u0648\u0646", "\u0632\u0648\u064A \u0643\u0631\u0627\u0641\u064A\u062A\u0632", "\u062C\u064A\u0641\u0631\u064A \u0631\u0627\u064A\u062A", "\u0643\u0648\u0644\u064A\u0646 \u0641\u0627\u0631\u064A\u0644"],
    director: "Matt Reeves",
    writer: "Matt Reeves",
    quality: "Ultra HD",
    servers: [
      { name: "\u0633\u064A\u0631\u0641\u0631 \u0631\u0626\u064A\u0633\u064A 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" }
    ]
  }
];
async function verifySubtitleUrl(url, langHint = "ar") {
  if (!url || typeof url !== "string") return false;
  let targetUrl = url.trim();
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) return false;
  if (targetUrl.includes("github.com") && targetUrl.includes("/blob/")) {
    targetUrl = targetUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  } else if (targetUrl.includes("archive.org/details/")) {
    targetUrl = targetUrl.replace("archive.org/details/", "archive.org/download/");
  }
  const lowerUrl = targetUrl.toLowerCase();
  if (lowerUrl.includes("/play") || lowerUrl.includes("/watch") || lowerUrl.includes("/search") || lowerUrl.includes("login") || lowerUrl.includes("register")) {
    return false;
  }
  try {
    let response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Range": "bytes=0-4096"
        // Only request the first 4KB for maximum speed
      },
      signal: AbortSignal.timeout(4e3)
    });
    if (!response.ok && response.status !== 206) {
      console.log(`[Subtitle Verification] First attempt (Range GET) failed with status ${response.status}. Retrying standard GET without Range...`);
      response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(5e3)
      });
    }
    if (!response.ok) {
      console.log(`[Subtitle Verification] Both range and standard GET attempts failed for: ${targetUrl}`);
      return false;
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
      console.log(`[Subtitle Verification] URL returned HTML webpage instead of raw subtitle file: ${targetUrl}`);
      return false;
    }
    const text = await response.text();
    const cleanText = text.trim();
    const looksLikeSubtitleFormat = cleanText.includes("WEBVTT") || cleanText.includes("-->");
    if (!looksLikeSubtitleFormat) {
      console.log(`[Subtitle Verification] Content did not look like VTT or SRT at: ${targetUrl}`);
      return false;
    }
    if (cleanText.length > 200 && !isPlausibleSubtitleContent(cleanText, langHint)) {
      console.log(`[Subtitle Verification] Content does not genuinely match requested language "${langHint}" at: ${targetUrl}`);
      return false;
    }
    console.log(`[Subtitle Verification] SUCCESS: Verified subtitle at: ${targetUrl}`);
    return true;
  } catch (err) {
    console.warn(`[Subtitle Verification] Connection failed for ${targetUrl}:`, err.message || err);
    return false;
  }
}
function decodeSubtitleBuffer(buffer, langHint) {
  try {
    const utf8Text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (langHint === "ar" && !/[؀-ۿ]/.test(utf8Text)) {
      const win1256Text = new TextDecoder("windows-1256").decode(buffer);
      if (/[؀-ۿ]/.test(win1256Text)) return win1256Text;
    }
    return utf8Text;
  } catch {
    return new TextDecoder("windows-1256").decode(buffer);
  }
}
function isPlausibleSubtitleContent(text, langHint) {
  if (!text || text.trim().length < 20) return false;
  const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = arabicChars + latinChars;
  if (totalLetters === 0) return false;
  if (langHint === "ar") {
    if (arabicChars < 15 || arabicChars / totalLetters < 0.4) return false;
  } else {
    if (arabicChars / totalLetters > 0.2) return false;
    if (latinChars < 40) return false;
  }
  const badCharRatio = (text.match(/[�-]/g) || []).length / text.length;
  if (badCharRatio > 0.01) return false;
  const cueLines = text.split(/\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->"));
  const nonSpeechLines = cueLines.filter((l) => /^\s*(\[.*\]|\(.*\)|uh+|um+)\s*$/i.test(l.trim()) || /download.{0,15}(free|mobile)/i.test(l));
  if (cueLines.length > 5 && nonSpeechLines.length / cueLines.length > 0.5) return false;
  return true;
}
async function downloadAndSaveSubtitleFromUrl(url, langHint = "ar") {
  try {
    if (!url || !url.startsWith("http")) return null;
    console.log(`[Subtitle Downloader] Fetching real subtitle file from: ${url}`);
    if (url.includes("subsource.net")) {
      return await downloadAndExtractSubsourceSubtitle(url, langHint);
    }
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/plain, text/vtt, application/x-subrip, application/octet-stream, */*"
      },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return null;
    const ab = await res.arrayBuffer();
    let buffer = Buffer.from(ab);
    if (buffer.length < 50) return null;
    let fileName = `subtitle_${langHint}.srt`;
    if (buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4) {
      try {
        const zip = new import_adm_zip.default(buffer);
        const entries = zip.getEntries();
        const entry = entries.find((e) => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
        }
      } catch (zipErr) {
        console.warn("[Subtitle Downloader] Unzip error:", zipErr.message);
      }
    }
    const finalDecodedText = decodeSubtitleBuffer(buffer, langHint);
    if (!finalDecodedText.includes("-->") && !finalDecodedText.includes("WEBVTT") && !fileName.endsWith(".srt") && !fileName.endsWith(".vtt")) {
      return null;
    }
    if (!isPlausibleSubtitleContent(finalDecodedText, langHint)) {
      console.warn(`[Subtitle Downloader] Rejected: content does not genuinely match requested language "${langHint}" or looks like non-dialogue noise: ${url}`);
      return null;
    }
    const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = `real_${langHint}_${Date.now()}_` + import_path2.default.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = import_path2.default.join(UPLOADS_DIR, finalName);
    import_fs.default.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subtitle Downloader] Saved real subtitle file to: ${filePath}`);
    return `/uploads/${finalName}`;
  } catch (err) {
    console.warn(`[Subtitle Downloader] Download failed for ${url}:`, err.message);
    return null;
  }
}
async function fetchWithRetry(url, options = {}, timeoutMs = 6e3) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
async function scrapeRealSubtitlesDirect(title, year, imdbId) {
  const result = { ar: "", en: "" };
  if (!title) return result;
  console.log(`[Real Subtitle Scraper] Programmatically locating real subtitle files for "${title}" (${year})...`);
  try {
    const cleanTitle = title.replace(/[^\w\s]/gi, " ").trim();
    const query = `title:("${cleanTitle}") AND (format:"SubRip" OR extension:srt OR extension:vtt) AND mediatype:(texts OR movies)`;
    const archiveUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title&output=json`;
    const res = await fetchWithRetry(archiveUrl, {}, 6e3);
    if (res.ok) {
      const json = await res.json();
      const docs = json.response?.docs || [];
      for (const doc2 of docs.slice(0, 3)) {
        const filesUrl = `https://archive.org/metadata/${doc2.identifier}/files`;
        const filesRes = await fetchWithRetry(filesUrl, {}, 5e3);
        if (filesRes.ok) {
          const filesJson = await filesRes.json();
          const srtFiles = (filesJson.result || []).filter(
            (f) => f.name && (f.name.toLowerCase().endsWith(".srt") || f.name.toLowerCase().endsWith(".vtt"))
          );
          for (const file of srtFiles) {
            const fileLower = file.name.toLowerCase();
            const isArabic = /(^|[._-])ar([._-]|$)/.test(fileLower) || fileLower.includes("arabic") || fileLower.includes("\u0639\u0631\u0628\u064A");
            const isEnglish = !isArabic && (/(^|[._-])en(g)?([._-]|$)/.test(fileLower) || fileLower.includes("english"));
            if (!isArabic && !isEnglish) continue;
            if (isArabic && result.ar) continue;
            if (isEnglish && result.en) continue;
            const langHint = isArabic ? "ar" : "en";
            const dlUrl = `https://archive.org/download/${doc2.identifier}/${file.name}`;
            const savedPath = await downloadAndSaveSubtitleFromUrl(dlUrl, langHint);
            if (savedPath) {
              if (langHint === "ar") result.ar = savedPath;
              else result.en = savedPath;
            }
          }
        }
        if (result.ar && result.en) break;
      }
    }
  } catch (err) {
    console.warn("[Real Subtitle Scraper] Archive.org search notice:", err.message);
  }
  return result;
}
async function downloadAndExtractSubsourceSubtitle(url, langHint = "ar") {
  try {
    console.log(`[Subsource Downloader] Starting download for: ${url}`);
    const idMatch = url.match(/\/(\d+)\/?$/) || url.match(/-(\d+)\/?$/) || url.match(/id=(\d+)/) || url.match(/subtitle\/[^\/]+\/(\d+)/);
    const id = idMatch ? idMatch[1] : null;
    let buffer = null;
    let fileName = "subtitle.srt";
    let downloadUrl = "";
    const tryUrls = [];
    if (id) {
      tryUrls.push(`https://api.subsource.net/api/download/${id}`);
      tryUrls.push(`https://subsource.net/subtitle/download-file/${id}`);
      tryUrls.push(`https://subsource.net/download/subtitle?id=${id}`);
    }
    tryUrls.push(url);
    for (const tryUrl of tryUrls) {
      try {
        console.log(`[Subsource Downloader] Trying direct download URL: ${tryUrl}`);
        const fetchRes = await fetch(tryUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "application/octet-stream, application/zip, */*"
          },
          signal: AbortSignal.timeout(8e3)
        });
        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get("content-type") || "";
          const contentDisposition = fetchRes.headers.get("content-disposition") || "";
          if (contentType.includes("text/html") && tryUrl === url && id) {
            continue;
          }
          const ab = await fetchRes.arrayBuffer();
          const tempBuf = Buffer.from(ab);
          if (tempBuf.length > 100) {
            buffer = tempBuf;
            downloadUrl = tryUrl;
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            if (filenameMatch) {
              fileName = filenameMatch[1];
            }
            break;
          }
        }
      } catch (err) {
        console.warn(`[Subsource Downloader] Failed direct URL ${tryUrl}:`, err.message);
      }
    }
    if (!buffer) {
      console.log(`[Subsource Downloader] Direct URLs failed. Fetching page HTML to extract ID...`);
      try {
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
          },
          signal: AbortSignal.timeout(8e3)
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const subIdMatch = html.match(/"id"\s*:\s*(\d+)/) || html.match(/download-file\/(\d+)/) || html.match(/subtitle\?id=(\d+)/) || html.match(/download\/(\d+)/);
          if (subIdMatch) {
            const extractedId = subIdMatch[1];
            console.log(`[Subsource Downloader] Extracted ID from HTML: ${extractedId}`);
            const fallbackUrls = [
              `https://api.subsource.net/api/download/${extractedId}`,
              `https://subsource.net/subtitle/download-file/${extractedId}`,
              `https://subsource.net/download/subtitle?id=${extractedId}`
            ];
            for (const fUrl of fallbackUrls) {
              try {
                const fRes = await fetch(fUrl, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
                  }
                });
                if (fRes.ok) {
                  const ab = await fRes.arrayBuffer();
                  buffer = Buffer.from(ab);
                  downloadUrl = fUrl;
                  break;
                }
              } catch (e) {
              }
            }
          }
        }
      } catch (htmlErr) {
        console.warn(`[Subsource Downloader] Failed to fetch page HTML:`, htmlErr.message);
      }
    }
    if (!buffer) {
      console.error(`[Subsource Downloader] Failed to download file for url: ${url}`);
      return null;
    }
    if (buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4) {
      console.log("[Subsource Downloader] ZIP file detected. Extracting...");
      try {
        const zip = new import_adm_zip.default(buffer);
        const zipEntries = zip.getEntries();
        const entry = zipEntries.find((e) => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
          console.log(`[Subsource Downloader] Extracted file: ${fileName}`);
        }
      } catch (zipErr) {
        console.error("[Subsource Downloader] Unzip error:", zipErr.message);
      }
    }
    const finalDecodedText = decodeSubtitleBuffer(buffer, langHint);
    if (!isPlausibleSubtitleContent(finalDecodedText, langHint)) {
      console.warn(`[Subsource Downloader] Rejected: content does not genuinely match requested language "${langHint}" or looks like non-dialogue noise: ${url}`);
      return null;
    }
    const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = "subsource_" + Date.now() + "_" + import_path2.default.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = import_path2.default.join(UPLOADS_DIR, finalName);
    import_fs.default.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subsource Downloader] Subtitle successfully saved to: ${filePath}`);
    return `/uploads/${finalName}`;
  } catch (err) {
    console.error("[Subsource Downloader] Error downloading subtitle:", err.message || err);
    return null;
  }
}
async function searchOpenSubtitles(title, year, lang, imdbId) {
  const apiKey2 = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey2 || !title) return null;
  try {
    const params = new URLSearchParams({ query: title, languages: lang, order_by: "download_count", order_direction: "desc" });
    if (year) params.set("year", String(year));
    if (imdbId) params.set("imdb_id", imdbId.replace(/^tt/i, ""));
    const searchRes = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`, {
      headers: {
        "Api-Key": apiKey2,
        "User-Agent": "CinemanaTV v1.0",
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(8e3)
    });
    if (!searchRes.ok) {
      console.warn(`[OpenSubtitles] Search failed with status ${searchRes.status} for "${title}" (${lang})`);
      return null;
    }
    const searchJson = await searchRes.json();
    const candidates = (searchJson?.data || []).slice(0, 5);
    if (candidates.length === 0) return null;
    for (const candidate of candidates) {
      const fileId = candidate?.attributes?.files?.[0]?.file_id;
      if (!fileId) continue;
      const dlRes = await fetch("https://api.opensubtitles.com/api/v1/download", {
        method: "POST",
        headers: {
          "Api-Key": apiKey2,
          "Content-Type": "application/json",
          "User-Agent": "CinemanaTV v1.0",
          "Accept": "application/json"
        },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!dlRes.ok) {
        if (dlRes.status === 406 || dlRes.status === 429) {
          console.warn(`[OpenSubtitles] Download quota reached (status ${dlRes.status}) - skipping remaining candidates for "${title}" (${lang}). This resets daily on the free tier.`);
          return null;
        }
        continue;
      }
      const dlJson = await dlRes.json();
      const link = dlJson?.link;
      if (!link) continue;
      const saved = await downloadAndSaveSubtitleFromUrl(link, lang);
      if (saved) {
        console.log(`[OpenSubtitles] Verified real ${lang} subtitle for "${title}": ${saved}`);
        return saved;
      }
    }
    console.warn(`[OpenSubtitles] Found ${candidates.length} candidate(s) for "${title}" (${lang}) but none downloaded/validated successfully.`);
    return null;
  } catch (err) {
    console.warn(`[OpenSubtitles] Lookup failed for "${title}" (${lang}):`, err.message);
    return null;
  }
}
async function findSubtitlesForWork(title, year, type, imdbId) {
  const result = { ar: "", en: "" };
  if (!title) return result;
  if (process.env.OPENSUBTITLES_API_KEY) {
    const [osAr, osEn] = await Promise.all([
      searchOpenSubtitles(title, year, "ar", imdbId),
      searchOpenSubtitles(title, year, "en", imdbId)
    ]);
    if (osAr) result.ar = osAr;
    if (osEn) result.en = osEn;
    if (result.ar && result.en) return result;
  }
  try {
    const directSubs = await scrapeRealSubtitlesDirect(title, year, imdbId);
    if (!result.ar && directSubs.ar) result.ar = directSubs.ar;
    if (!result.en && directSubs.en) result.en = directSubs.en;
    if (result.ar && result.en) return result;
  } catch (err) {
    console.warn("[Subtitles] Direct subtitle scraper error:", err.message);
  }
  if (ai && Date.now() >= quotaExceededUntil && (!result.ar || !result.en)) {
    const neededLangs = [!result.ar ? "arabic" : null, !result.en ? "english" : null].filter(Boolean).join(" and ");
    const prompt = `\u0623\u0646\u062A \u0628\u0627\u062D\u062B \u062F\u0642\u064A\u0642 \u062A\u0628\u062D\u062B \u062D\u0635\u0631\u0627\u064B \u0639\u0646 \u0645\u0644\u0641\u0627\u062A \u062A\u0631\u062C\u0645\u0629 (Subtitles) \u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u0639\u0644\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A.
\u0645\u0647\u0645\u062A\u0643 \u0647\u064A \u0627\u0644\u0628\u062D\u062B \u0627\u0644\u0641\u0639\u0644\u064A \u0639\u0628\u0631 \u0623\u062F\u0627\u0629 \u0627\u0644\u0628\u062D\u062B (googleSearch) \u0639\u0646 \u0631\u0648\u0627\u0628\u0637 \u062A\u062D\u0645\u064A\u0644 \u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u062A\u062D\u0642\u0642 \u0644\u0645\u0644\u0641\u0627\u062A \u062A\u0631\u062C\u0645\u0629 ${neededLangs} \u0644\u0644\u0639\u0645\u0644 \u0627\u0644\u062A\u0627\u0644\u064A:
\u0627\u0644\u0639\u0646\u0648\u0627\u0646: "${title}"
\u0633\u0646\u0629 \u0627\u0644\u0625\u0646\u062A\u0627\u062C: ${year}
\u0627\u0644\u0646\u0648\u0639: ${type}

\u062C\u0631\u0651\u0628 \u0627\u0633\u062A\u0639\u0644\u0627\u0645\u0627\u062A \u0645\u062B\u0644:
1. "site:opensubtitles.com \\"${title}\\""
2. "site:subsource.net \\"${title}\\""
3. "site:github.com \\"${title}\\" (srt | vtt)"
4. "site:archive.org/download \\"${title}\\" srt"

\u0642\u0627\u0639\u062F\u0629 \u0635\u0627\u0631\u0645\u0629: \u0625\u0630\u0627 \u0644\u0645 \u062A\u062C\u062F \u0631\u0627\u0628\u0637\u0627\u064B \u062D\u0642\u064A\u0642\u064A\u0627\u064B \u0645\u0624\u0643\u062F\u0627\u064B \u0645\u0646 \u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0628\u062D\u062B \u0627\u0644\u0641\u0639\u0644\u064A\u0629\u060C \u0623\u0639\u062F \u0633\u0644\u0633\u0644\u0629 \u0646\u0635\u064A\u0629 \u0641\u0627\u0631\u063A\u0629 \u0644\u062A\u0644\u0643 \u0627\u0644\u0644\u063A\u0629. \u0645\u0645\u0646\u0648\u0639 \u0645\u0646\u0639\u0627\u064B \u0628\u0627\u062A\u0627\u064B \u0627\u062E\u062A\u0644\u0627\u0642 \u0623\u0648 \u062A\u062E\u0645\u064A\u0646 \u0623\u0648 \u0627\u0641\u062A\u0631\u0627\u0636 \u0623\u064A \u0631\u0627\u0628\u0637 \u063A\u064A\u0631 \u0645\u0624\u0643\u062F \u0628\u062D\u062B \u0641\u0639\u0644\u064A \u0639\u0646\u0647.
\u0623\u0639\u062F \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u0628\u0635\u064A\u063A\u0629 JSON \u0641\u0642\u0637 \u0628\u062F\u0648\u0646 \u0623\u064A \u0646\u0635 \u0625\u0636\u0627\u0641\u064A:
{
  "ar": "\u0631\u0627\u0628\u0637 \u062D\u0642\u064A\u0642\u064A \u0648\u062C\u062F\u062A\u0647 \u0641\u0639\u0644\u0627\u064B \u0641\u064A \u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0628\u062D\u062B \u0623\u0648 \u0641\u0627\u0631\u063A",
  "en": "\u0631\u0627\u0628\u0637 \u062D\u0642\u064A\u0642\u064A \u0648\u062C\u062F\u062A\u0647 \u0641\u0639\u0644\u0627\u064B \u0641\u064A \u0646\u062A\u0627\u0626\u062C \u0627\u0644\u0628\u062D\u062B \u0623\u0648 \u0641\u0627\u0631\u063A"
}`;
    try {
      console.log(`[Subtitles] Attempting Search Grounded Subtitle lookup for: ${title} (${year})`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: import_genai.Type.OBJECT,
            required: ["ar", "en"],
            properties: {
              ar: { type: import_genai.Type.STRING },
              en: { type: import_genai.Type.STRING }
            }
          }
        }
      });
      const resultText = response.text?.trim();
      if (resultText) {
        const parsed = JSON.parse(resultText);
        if (!result.ar && parsed.ar && parsed.ar.trim()) {
          const saved = await downloadAndSaveSubtitleFromUrl(parsed.ar.trim(), "ar");
          if (saved) result.ar = saved;
          else if (await verifySubtitleUrl(parsed.ar.trim(), "ar")) result.ar = parsed.ar.trim();
        }
        if (!result.en && parsed.en && parsed.en.trim()) {
          const saved = await downloadAndSaveSubtitleFromUrl(parsed.en.trim(), "en");
          if (saved) result.en = saved;
          else if (await verifySubtitleUrl(parsed.en.trim(), "en")) result.en = parsed.en.trim();
        }
      }
    } catch (error) {
      console.warn("[Subtitles] Search Grounded subtitle lookup failed:", error.message);
    }
  }
  return result;
}
async function generateMovieWithGemini(query) {
  if (!ai) return null;
  if (Date.now() < quotaExceededUntil) {
    console.warn("[Server] Skipping dynamic Gemini search generation: rate-limited/cooldown active.");
    return null;
  }
  try {
    const prompt = `\u0645\u0647\u0645\u062A\u0643 \u0647\u064A \u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0648\u064A\u0628 \u0644\u062A\u0648\u0644\u064A\u062F \u0648\u0625\u0631\u062C\u0627\u0639 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0643\u0627\u0645\u0644\u0629 \u0648\u062F\u0642\u064A\u0642\u0629 \u062C\u062F\u0627\u064B \u0648\u062D\u0642\u064A\u0642\u064A\u0629 \u0639\u0646 \u0627\u0644\u0641\u064A\u0644\u0645 \u0623\u0648 \u0627\u0644\u0645\u0633\u0644\u0633\u0644 \u0627\u0644\u0645\u0628\u062D\u0648\u062B \u0639\u0646\u0647 \u0628\u0627\u0644\u0644\u063A\u062A\u064A\u0646 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0648\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629.
\u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0627\u0644\u0628\u062D\u062B \u0639\u0646\u0647: "${query}"

\u0627\u0628\u062D\u062B \u0628\u062F\u0642\u0629 \u0628\u0627\u0644\u063A\u0629 \u0641\u064A \u0627\u0644\u0648\u064A\u0628 \u0648\u062E\u0648\u0627\u062F\u0645 TMDB (The Movie Database) \u0623\u0648 IMDb \u0623\u0648 \u0648\u064A\u0643\u064A\u0628\u064A\u062F\u064A\u0627 \u0639\u0646:
- \u0627\u0633\u0645 \u0627\u0644\u0641\u064A\u0644\u0645/\u0627\u0644\u0645\u0633\u0644\u0633\u0644 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0648\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629.
- \u0633\u0646\u0629 \u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0643\u0640 \u0631\u0642\u0645.
- \u0627\u0644\u062A\u0642\u064A\u064A\u0645 \u0627\u0644\u062D\u0642\u064A\u0642\u064A (Rating) \u0645\u0646 10 (\u0645\u062B\u0644 8.5).
- \u0627\u0644\u0645\u062F\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0644\u0623\u0641\u0644\u0627\u0645 \u0623\u0648 \u0639\u062F\u062F \u0627\u0644\u062D\u0644\u0642\u0627\u062A \u0644\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A.
- \u0627\u0644\u062A\u0635\u0646\u064A\u0641\u0627\u062A \u0627\u0644\u0641\u0646\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 (Genres) \u0645\u062B\u0644 "\u0623\u0643\u0634\u0646"\u060C "\u0645\u063A\u0627\u0645\u0631\u0629".
- \u0642\u0635\u0629 \u0627\u0644\u0641\u064A\u0644\u0645 \u0623\u0648 \u0627\u0644\u0645\u0633\u0644\u0633\u0644 \u0628\u0627\u0644\u062A\u0641\u0635\u064A\u0644 \u0648\u0627\u0644\u062A\u0634\u0648\u064A\u0642 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 (storyAr) \u0648\u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 (storyEn).
- \u0627\u0644\u0645\u0645\u062B\u0644\u064A\u0646 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u064A\u0646 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u064A\u0646 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u0644 (actors).
- \u0627\u0644\u0645\u062E\u0631\u062C \u0627\u0644\u062D\u0642\u064A\u0642\u064A (director) \u0648\u0627\u0644\u0643\u0627\u062A\u0628 \u0627\u0644\u062D\u0642\u064A\u0642\u064A (writer) \u0644\u0644\u0639\u0645\u0644 \u0627\u0644\u0641\u0646\u064A.
- \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0627\u0644\u0628\u0648\u0633\u062A\u0631 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0627\u0644\u0648\u0627\u0642\u0639\u064A\u0629 \u0644\u0644\u0639\u0645\u0644 \u0627\u0644\u0641\u0646\u064A \u0646\u0641\u0633\u0647 \u062A\u0646\u062A\u0647\u064A \u0628\u0640 .jpg \u0623\u0648 .png. \u064A\u0641\u0636\u0651\u0644 \u0644\u0644\u063A\u0627\u064A\u0629 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0635\u0648\u0631 \u0627\u0644\u0628\u0648\u0633\u062A\u0631\u0627\u062A \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0645\u0646 \u062E\u0648\u0627\u062F\u0645 TMDB \u0627\u0644\u0634\u0647\u064A\u0631\u0629 \u0645\u062B\u0644 (https://image.tmdb.org/t/p/w500/...) \u0644\u0644\u0628\u0648\u0633\u062A\u0631 \u0648 (https://image.tmdb.org/t/p/original/...) \u0644\u0644\u062E\u0644\u0641\u064A\u0629\u060C \u0623\u0648 \u0635\u0648\u0631 IMDb \u0623\u0648 \u0648\u064A\u0643\u064A\u0628\u064A\u062F\u064A\u0627 \u0644\u062A\u0643\u0648\u0646 \u0627\u0644\u0628\u0648\u0633\u062A\u0631\u0627\u062A \u0648\u0627\u0644\u062E\u0644\u0641\u064A\u0627\u062A \u0648\u0627\u0642\u0639\u064A\u0629 \u0648\u0645\u0637\u0627\u0628\u0642\u0629 \u0628\u0646\u0633\u0628\u0629 100% \u0644\u0644\u0639\u0645\u0644 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u060C \u0648\u062A\u062C\u0646\u0628 \u062A\u0645\u0627\u0645\u0627\u064B \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0635\u0648\u0631 Unsplash \u0627\u0644\u0639\u0634\u0648\u0627\u0626\u064A\u0629 \u0623\u0648 \u063A\u064A\u0631 \u0627\u0644\u0648\u0627\u0642\u0639\u064A\u0629.
- \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0627\u0644\u0645\u062E\u0631\u062C (directorPhotoUrl) \u0648\u0627\u0644\u0643\u0627\u062A\u0628 (writerPhotoUrl) \u0645\u0646 TMDB (https://image.tmdb.org/t/p/w185/...) \u0623\u0648 IMDb (https://m.media-amazon.com/images/M/...). \u0627\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0645\u062E\u0631\u062C \u0648\u0627\u0644\u0643\u0627\u062A\u0628 \u0639\u0644\u0649 \u062C\u0648\u062C\u0644 \u0644\u0636\u0645\u0627\u0646 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0635\u0648\u0631\u0647\u0645 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629. \u0644\u0627 \u062A\u0633\u062A\u062E\u062F\u0645 \u0631\u0648\u0627\u0628\u0637 \u0639\u0634\u0648\u0627\u0626\u064A\u0629 \u0623\u0648 \u0635\u0648\u0631\u0627\u064B \u063A\u064A\u0631 \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0647\u0645\u0627.
- \u0642\u0627\u0626\u0645\u0629 \u0637\u0627\u0642\u0645 \u0627\u0644\u0639\u0645\u0644 (castMembers) \u0645\u0639 \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631\u0647\u0645 \u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 (photoUrl) \u0648\u0627\u0644\u0627\u0633\u0645 (name) \u0648\u0627\u0644\u062F\u0648\u0631 (role) \u0645\u0646 TMDB \u0623\u0648 IMDb \u0627\u0644\u0634\u062E\u0635\u064A\u0629. \u064A\u062C\u0628 \u0639\u0644\u064A\u0643 \u0625\u062F\u062E\u0627\u0644 \u0645\u0627 \u0644\u0627 \u064A\u0642\u0644 \u0639\u0646 6 \u0645\u0645\u062B\u0644\u064A\u0646 \u0631\u0626\u064A\u0633\u064A\u064A\u0646 \u0644\u0644\u0639\u0645\u0644\u060C \u0648\u062A\u0648\u0641\u064A\u0631 \u0623\u0633\u0645\u0627\u0626\u0647\u0645 \u0648\u0635\u0648\u0631\u0647\u0645 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0627\u0644\u0645\u0633\u062A\u0648\u0631\u062F\u0629 \u0628\u062F\u0642\u0629 \u0645\u0646 \u062E\u0648\u0627\u062F\u0645 TMDB (https://image.tmdb.org/t/p/w185/...) \u0623\u0648 \u0635\u0648\u0631 IMDb (https://m.media-amazon.com/images/M/...) \u0645\u0639 \u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0628\u0640 .jpg \u0644\u0636\u0645\u0627\u0646 \u0638\u0647\u0648\u0631 \u0635\u0648\u0631 \u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0637\u0627\u0642\u0645 \u0627\u0644\u0639\u0645\u0644 \u0641\u064A \u0627\u0644\u062A\u0637\u0628\u064A\u0642.
- \u0648\u0641\u0631 \u0645\u0634\u063A\u0644\u0627\u062A \u0641\u064A\u062F\u064A\u0648 \u0648\u0647\u0645\u064A\u0629 \u0648\u0644\u0643\u0646 \u0628\u0631\u0648\u0627\u0628\u0637 mp4 \u062D\u0642\u064A\u0642\u064A\u0629 \u0633\u0631\u064A\u0639\u0629 \u062C\u062F\u0627\u064B \u0635\u0627\u0644\u062D\u0629 \u0644\u0644\u062A\u0634\u063A\u064A\u0644 \u0641\u064A \u0645\u0634\u063A\u0644 \u0627\u0644\u0641\u064A\u062F\u064A\u0648 \u0627\u0644\u062E\u0627\u0635 \u0628\u0627\u0644\u062A\u0637\u0628\u064A\u0642 (\u0627\u0633\u062A\u062E\u062F\u0645 \u062D\u0635\u0631\u064A\u0627\u064B \u0623\u062D\u062F \u0647\u0630\u0647 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0627\u0644\u0635\u0627\u0644\u062D\u0629 \u0644\u0644\u0628\u062B:
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4").
\u0642\u0645 \u0628\u062A\u0633\u0645\u064A\u0629 \u0647\u0630\u0647 \u0627\u0644\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0628\u0623\u0633\u0645\u0627\u0621 \u0648\u0627\u0642\u0639\u064A\u0629 \u0643\u0640 "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A" \u0623\u0648 "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A" \u0623\u0648 "\u0627\u0644\u062D\u0644\u0642\u0629 1 HD" \u0644\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A.
\u0627\u062A\u0631\u0643 \u062D\u0642\u0648\u0644 subtitlesUrlAr \u0648 subtitlesUrlEn \u0641\u0627\u0631\u063A\u062A\u064A\u0646 \u062A\u0645\u0627\u0645\u0627\u064B \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629. \u0633\u064A\u062A\u0645 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0628\u0634\u0643\u0644 \u0645\u0646\u0641\u0635\u0644 \u0639\u0628\u0631 \u0646\u0638\u0627\u0645 \u0645\u062E\u0635\u0635 \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646\u0647\u0627 \u0641\u0639\u0644\u064A\u0627\u064B \u0642\u0628\u0644 \u0627\u0633\u062A\u062E\u062F\u0627\u0645\u0647\u0627. \u0645\u0645\u0646\u0648\u0639 \u0645\u0646\u0639\u0627\u064B \u0628\u0627\u062A\u0627\u064B \u0627\u062E\u062A\u0644\u0627\u0642 \u0623\u0648 \u062A\u062E\u0645\u064A\u0646 \u0623\u064A \u0631\u0627\u0628\u0637 \u062A\u0631\u062C\u0645\u0629 \u063A\u064A\u0631 \u0645\u0624\u0643\u062F.

\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u0635\u064A\u063A\u0629 JSON \u062D\u0635\u0631\u064A\u0627\u064B \u0648\u0645\u0637\u0627\u0628\u0642\u0627\u064B \u0644\u0644\u0628\u0646\u064A\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629:
{
  "id": "\u0645\u0639\u0631\u0641 \u0641\u0631\u064A\u062F \u064A\u0628\u062F\u0623 \u0628\u0640 gemini_",
  "titleAr": "\u0627\u0633\u0645 \u0627\u0644\u0641\u064A\u0644\u0645/\u0627\u0644\u0645\u0633\u0644\u0633\u0644 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649",
  "titleEn": "English Title",
  "type": "movie \u0623\u0648 series",
  "rating": \u0631\u0642\u0645 \u0628\u064A\u0646 1.0 \u0648 10.0,
  "year": \u0633\u0646\u0629 \u0627\u0644\u0625\u0646\u062A\u0627\u062C \u0643\u0640 \u0631\u0642\u0645,
  "duration": "\u0627\u0644\u0645\u062F\u0629 \u0645\u062B\u0644 2h 15m \u0644\u0644\u0623\u0641\u0644\u0627\u0645 \u0623\u0648 \u0639\u062F\u062F \u0627\u0644\u062D\u0644\u0642\u0627\u062A \u0644\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A",
  "genres": ["\u062A\u0635\u0646\u064A\u0641 1", "\u062A\u0635\u0646\u064A\u0641 2"],
  "poster": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0628\u0648\u0633\u062A\u0631 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0645\u0646 TMDB/IMDb",
  "backdrop": "\u0631\u0627\u0628\u0637 \u0627\u0644\u062E\u0644\u0641\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0645\u0646 TMDB/IMDb",
  "storyAr": "\u0642\u0635\u0629 \u0648\u0633\u064A\u0646\u0627\u0631\u064A\u0648 \u0645\u0634\u0648\u0642 \u0648\u0645\u0641\u0635\u0644 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0645\u0646 \u0633\u064A\u0646\u0645\u0627\u0646\u0627",
  "storyEn": "Detailed synopsis in English from Cinemana",
  "actors": ["\u0645\u0645\u062B\u0644 1", "\u0645\u0645\u062B\u0644 2", "\u0645\u0645\u062B\u0644 3"],
  "director": "\u0627\u0633\u0645 \u0627\u0644\u0645\u062E\u0631\u062C",
  "writer": "\u0627\u0633\u0645 \u0627\u0644\u0643\u0627\u062A\u0628",
  "directorPhotoUrl": "\u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629 \u0627\u0644\u0645\u062E\u0631\u062C \u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0645\u0646 TMDB/IMDb \u0623\u0648 \u0641\u0627\u0631\u063A",
  "writerPhotoUrl": "\u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629 \u0627\u0644\u0643\u0627\u062A\u0628 \u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0645\u0646 TMDB/IMDb \u0623\u0648 \u0641\u0627\u0631\u063A",
  "castMembers": [
    {
      "name": "\u0627\u0633\u0645 \u0627\u0644\u0645\u0645\u062B\u0644",
      "role": "\u0627\u0633\u0645 \u0627\u0644\u0634\u062E\u0635\u064A\u0629 \u0623\u0648 \u0627\u0644\u062F\u0648\u0631",
      "photoUrl": "\u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u062A\u0647 \u0645\u0646 TMDB/IMDb \u0623\u0648 \u0641\u0627\u0631\u063A"
    }
  ],
  "quality": "Ultra HD \u0623\u0648 Full HD",
  "subtitlesUrlAr": "\u0631\u0627\u0628\u0637 \u0645\u0644\u0641 \u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 vtt \u0623\u0648 srt \u0623\u0648 \u0641\u0627\u0631\u063A",
  "subtitlesUrlEn": "\u0631\u0627\u0628\u0637 \u0645\u0644\u0641 \u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629 vtt \u0623\u0648 srt \u0623\u0648 \u0641\u0627\u0631\u063A",
  "trailerUrl": "\u0631\u0627\u0628\u0637 \u0625\u0639\u0644\u0627\u0646 \u0627\u0644\u0641\u064A\u0644\u0645 \u0627\u0644\u0631\u0633\u0645\u064A \u0639\u0644\u0649 \u064A\u0648\u062A\u064A\u0648\u0628",
  "servers": [
    {"name": "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A", "url": "\u0631\u0627\u0628\u0637 mp4 \u0627\u0644\u0645\u062E\u062A\u0627\u0631 \u0645\u0646 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0623\u0639\u0644\u0627\u0647"},
    {"name": "\u0633\u064A\u0631\u0641\u0631 \u0627\u062D\u062A\u064A\u0627\u0637\u064A HD", "url": "\u0631\u0627\u0628\u0637 mp4 \u0627\u0644\u0628\u062F\u064A\u0644 \u0627\u0644\u0645\u062E\u062A\u0627\u0631 \u0645\u0646 \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0623\u0639\u0644\u0627\u0647"}
  ]
}`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          required: [
            "id",
            "titleAr",
            "titleEn",
            "type",
            "rating",
            "year",
            "duration",
            "genres",
            "poster",
            "backdrop",
            "storyAr",
            "storyEn",
            "actors",
            "director",
            "writer",
            "directorPhotoUrl",
            "writerPhotoUrl",
            "castMembers",
            "quality",
            "servers"
          ],
          properties: {
            id: { type: import_genai.Type.STRING },
            titleAr: { type: import_genai.Type.STRING },
            titleEn: { type: import_genai.Type.STRING },
            type: { type: import_genai.Type.STRING },
            rating: { type: import_genai.Type.NUMBER },
            year: { type: import_genai.Type.INTEGER },
            duration: { type: import_genai.Type.STRING },
            genres: {
              type: import_genai.Type.ARRAY,
              items: { type: import_genai.Type.STRING }
            },
            poster: { type: import_genai.Type.STRING },
            backdrop: { type: import_genai.Type.STRING },
            storyAr: { type: import_genai.Type.STRING },
            storyEn: { type: import_genai.Type.STRING },
            actors: {
              type: import_genai.Type.ARRAY,
              items: { type: import_genai.Type.STRING }
            },
            director: { type: import_genai.Type.STRING },
            writer: { type: import_genai.Type.STRING },
            directorPhotoUrl: { type: import_genai.Type.STRING },
            writerPhotoUrl: { type: import_genai.Type.STRING },
            castMembers: {
              type: import_genai.Type.ARRAY,
              items: {
                type: import_genai.Type.OBJECT,
                required: ["name", "photoUrl"],
                properties: {
                  name: { type: import_genai.Type.STRING },
                  role: { type: import_genai.Type.STRING },
                  photoUrl: { type: import_genai.Type.STRING }
                }
              }
            },
            quality: { type: import_genai.Type.STRING },
            subtitlesUrlAr: { type: import_genai.Type.STRING },
            subtitlesUrlEn: { type: import_genai.Type.STRING },
            trailerUrl: { type: import_genai.Type.STRING },
            servers: {
              type: import_genai.Type.ARRAY,
              items: {
                type: import_genai.Type.OBJECT,
                required: ["name", "url"],
                properties: {
                  name: { type: import_genai.Type.STRING },
                  url: { type: import_genai.Type.STRING }
                }
              }
            }
          }
        }
      }
    });
    const resultText = response.text?.trim();
    if (resultText) {
      const parsedMovie = JSON.parse(resultText);
      parsedMovie.subtitlesUrlAr = getValidSubtitleUrl(parsedMovie.subtitlesUrlAr, parsedMovie.id, "ar", void 0, void 0, parsedMovie);
      parsedMovie.subtitlesUrlEn = getValidSubtitleUrl(parsedMovie.subtitlesUrlEn, parsedMovie.id, "en", void 0, void 0, parsedMovie);
      parsedMovie.poster = await verifyAndCorrectImageUrl(parsedMovie.poster, parsedMovie.titleEn || parsedMovie.titleAr, false, parsedMovie.genres);
      parsedMovie.backdrop = await verifyAndCorrectImageUrl(parsedMovie.backdrop, parsedMovie.titleEn || parsedMovie.titleAr, true, parsedMovie.genres);
      if (parsedMovie.director) {
        parsedMovie.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedMovie.director, parsedMovie.directorPhotoUrl);
      }
      if (parsedMovie.writer) {
        parsedMovie.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedMovie.writer, parsedMovie.writerPhotoUrl);
      }
      if (parsedMovie.castMembers && Array.isArray(parsedMovie.castMembers)) {
        for (const cast of parsedMovie.castMembers) {
          cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
        }
      }
      return parsedMovie;
    }
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    handleGeminiError(error, "generateMovieWithGemini");
  }
  return null;
}
var cachedHomeData = null;
var lastCacheTime = 0;
var CACHE_DURATION = 30 * 60 * 1e3;
var isFetchingHome = false;
async function fetchHomeMoviesFromGemini() {
  if (!ai || isFetchingHome) return cachedHomeData;
  if (Date.now() < quotaExceededUntil) {
    console.warn("[Server] Skipping home categories Gemini fetch: rate-limited/cooldown active.");
    return cachedHomeData;
  }
  isFetchingHome = true;
  try {
    console.log("[Server] Fetching live Cinemana homepage content via Gemini Search Grounding...");
    const prompt = `\u0623\u0646\u062A \u062E\u0628\u064A\u0631 \u0645\u062D\u062A\u0631\u0641 \u0648\u0645\u0633\u0624\u0648\u0644 \u062F\u0645\u062C \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0644\u0634\u0628\u0643\u062A\u064A \u0633\u064A\u0646\u0645\u0627\u0646\u0627 (Cinemana Shabakaty).
\u0642\u0645 \u0628\u0628\u062D\u062B \u0645\u0628\u0627\u0634\u0631 \u0648\u062F\u0642\u064A\u0642 \u0628\u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0645\u062D\u0631\u0643 \u0627\u0644\u0628\u062D\u062B \u062C\u0648\u062C\u0644 \u0639\u0646 \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0627\u0644\u0641\u0639\u0627\u0644\u0629 \u0644\u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0634\u0628\u0643\u062A\u064A: "https://cinemana.shabakaty.com/home" \u0623\u0648 "\u0645\u0648\u0642\u0639 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0634\u0628\u0643\u062A\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A".
\u0627\u0633\u062A\u062E\u0631\u062C \u0628\u062F\u0642\u0629 \u0634\u062F\u064A\u062F\u0629 \u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0648\u0628\u0646\u0631 \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u062D\u0627\u0644\u064A\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0644\u062D\u0638\u0629.
\u0646\u0631\u064A\u062F\u0643 \u0623\u0646 \u062A\u0639\u0643\u0633 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u0648\u0642\u0639 \u0627\u0644\u0641\u0639\u0644\u064A \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0648\u0628\u0646\u0633\u0628\u0629 100% \u0648\u062A\u0635\u0646\u0641\u0647\u0627 \u0641\u064A \u0648\u0627\u062C\u0647\u062A\u0646\u0627:

\u062A\u062D\u062F\u064A\u062F\u0627\u064B\u060C \u0642\u0645 \u0628\u062A\u0648\u0644\u064A\u062F \u0643\u0627\u0626\u0646 JSON \u0645\u062A\u0643\u0627\u0645\u0644 \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649:
1. "hero": \u0627\u0644\u0639\u0645\u0644 \u0627\u0644\u0641\u0646\u064A \u0627\u0644\u0631\u0626\u064A\u0633\u064A (\u0627\u0644\u0628\u0646\u0631 \u0627\u0644\u0645\u062A\u0635\u062F\u0631) \u0627\u0644\u0645\u0639\u0631\u0648\u0636 \u0643\u062E\u0644\u0641\u064A\u0629 \u0648\u0628\u0637\u0644 \u0627\u0644\u0635\u0641\u062D\u0629 \u0641\u064A "https://cinemana.shabakaty.com/home" \u062D\u0627\u0644\u064A\u0627\u064B (\u0641\u064A\u0644\u0645 \u0623\u0648 \u0645\u0633\u0644\u0633\u0644 \u062D\u062F\u064A\u062B \u0648\u0634\u0627\u0626\u0639\u060C \u0627\u0633\u062A\u062E\u0631\u062C \u0627\u0633\u0645\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0648\u0639\u0646\u0627\u0635\u0631\u0647 \u0648\u0642\u0635\u062A\u0647 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629).
2. "categories": \u0645\u0635\u0641\u0648\u0641\u0629 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0627\u0644\u0641\u0626\u0627\u062A \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u0627\u0644\u0645\u0623\u062E\u0648\u0630\u0629 \u0645\u0646 \u062A\u0635\u0646\u064A\u0641\u0627\u062A \u0648\u0642\u0648\u0627\u0626\u0645 \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0644\u0633\u064A\u0646\u0645\u0627\u0646\u0627:
   - "recent" (\u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0627\u0644\u0645\u0636\u0627\u0641\u0629 \u062D\u062F\u064A\u062B\u0627\u064B \u0639\u0644\u0649 \u0633\u064A\u0646\u0645\u0627\u0646\u0627)
   - "trending" (\u0627\u0644\u0623\u0643\u062B\u0631 \u0645\u0634\u0627\u0647\u062F\u0629 \u0648\u0627\u0644\u0623\u0639\u0644\u0649 \u062A\u0642\u064A\u064A\u0645\u0627\u064B \u0641\u064A \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u062D\u0627\u0644\u064A\u0627\u064B)
   - "series" (\u0623\u062D\u062F\u062B \u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0648\u0627\u0644\u0628\u0631\u0627\u0645\u062C \u0627\u0644\u062A\u0644\u0641\u0632\u064A\u0648\u0646\u064A\u0629 \u0639\u0644\u0649 \u0633\u064A\u0646\u0645\u0627\u0646\u0627)
   - "action" (\u0623\u0641\u0644\u0627\u0645 \u0627\u0644\u0623\u0643\u0634\u0646 \u0648\u0627\u0644\u0645\u063A\u0627\u0645\u0631\u0629 \u0627\u0644\u0645\u062A\u0648\u0641\u0631\u0629 \u0639\u0644\u0649 \u0633\u064A\u0646\u0645\u0627\u0646\u0627)
   - "movies" (\u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0627\u0644\u0645\u0645\u064A\u0632\u0629 \u0648\u0627\u0644\u062C\u062F\u064A\u062F\u0629 \u0627\u0644\u0645\u0639\u0631\u0648\u0636\u0629 \u0639\u0644\u0649 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u062D\u0627\u0644\u064A\u0627\u064B)

\u064A\u062C\u0628 \u0623\u0646 \u064A\u062D\u062A\u0648\u064A \u0643\u0644 \u0641\u064A\u0644\u0645/\u0645\u0633\u0644\u0633\u0644 \u0641\u064A \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0639\u0644\u0649 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0627\u0644\u0648\u0627\u0642\u0639\u064A\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0645\u0646 \u0639\u0646\u0627\u0648\u064A\u0646 \u0648\u0642\u0635\u0629 \u0648\u062A\u0635\u0646\u064A\u0641\u0627\u062A \u0648\u0645\u0645\u062B\u0644\u064A\u0646 \u0648\u062A\u0648\u0641\u064A\u0631 \u0633\u064A\u0631\u0641\u0631 \u062A\u0634\u063A\u064A\u0644 \u0645\u0628\u0627\u0634\u0631 \u0648\u0627\u062D\u062F \u0641\u0642\u0637 \u0644\u0643\u0644 \u0639\u0645\u0644 \u0641\u0646\u064A \u0623\u0648 \u062D\u0644\u0642\u0629 \u0645\u0633\u0644\u0633\u0644\u060C \u0645\u0633\u062A\u062E\u0631\u062C\u0627\u064B \u0623\u0648 \u0645\u0646\u0634\u0623\u064B \u0645\u0628\u0627\u0634\u0631\u0629\u064B \u0645\u0646 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0628\u0635\u064A\u063A\u0629 m3u8 (\u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0628\u0627\u0634\u0631 \u0644\u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0644\u0644\u0623\u0641\u0644\u0627\u0645 \u064A\u0643\u0648\u0646 \u0628\u0627\u0644\u0635\u064A\u063A\u0629: https://video.shabakaty.com/movies/{id}/index.m3u8 \u062D\u064A\u062B id \u0647\u0648 \u0627\u0644\u0645\u0639\u0631\u0641 \u0627\u0644\u0631\u0642\u0645\u064A \u0627\u0644\u062D\u0642\u064A\u0642\u064A \u0644\u0644\u0641\u064A\u0644\u0645 \u0641\u064A \u0633\u064A\u0646\u0645\u0627\u0646\u0627\u060C \u0648\u0644\u062D\u0644\u0642\u0627\u062A \u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u064A\u0643\u0648\u0646 \u0628\u0627\u0644\u0635\u064A\u063A\u0629: https://video.shabakaty.com/movies/{series_id}/{season_number}/{episode_number}/index.m3u8 \u062D\u064A\u062B series_id \u0647\u0648 \u0627\u0644\u0645\u0639\u0631\u0641 \u0627\u0644\u0631\u0642\u0645\u064A \u0644\u0644\u0645\u0633\u0644\u0633\u0644. \u064A\u062C\u0628 \u0623\u0646 \u062A\u062D\u062A\u0648\u064A \u0645\u0635\u0641\u0648\u0641\u0629 "servers" \u0639\u0644\u0649 \u0639\u0646\u0635\u0631 \u0648\u0627\u062D\u062F \u0641\u0642\u0637 \u0644\u0627 \u063A\u064A\u0631 \u0648\u062A\u0633\u0645\u064A\u0647 "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631").
\u0627\u0628\u062D\u062B \u0628\u062F\u0642\u0629 \u0641\u064A \u0627\u0644\u0648\u064A\u0628 \u0648\u0641\u064A \u062E\u0648\u0627\u062F\u0645 TMDB (The Movie Database) \u0623\u0648 IMDb \u0623\u0648 Wikipedia \u0639\u0646 \u0631\u0648\u0627\u0628\u0637 \u0635\u0648\u0631 \u0627\u0644\u0628\u0648\u0633\u062A\u0631\u0627\u062A \u0648\u0627\u0644\u062E\u0644\u0641\u064A\u0627\u062A \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0648\u0627\u0644\u0645\u0637\u0627\u0628\u0642\u0629 \u062A\u0645\u0627\u0645\u0627\u064B \u0644\u0643\u0644 \u0639\u0645\u0644 \u0641\u0646\u064A\u060C \u064A\u0641\u0636\u0644 \u062F\u0627\u0626\u0645\u0627\u064B \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u062E\u0648\u0627\u062F\u0645 TMDB \u0627\u0644\u0634\u0647\u064A\u0631\u0629 \u0645\u062B\u0644 (https://image.tmdb.org/t/p/w500/...) \u0644\u0644\u0628\u0648\u0633\u062A\u0631\u0627\u062A \u0648 (https://image.tmdb.org/t/p/original/...) \u0644\u0644\u062E\u0644\u0641\u064A\u0627\u062A \u0644\u0636\u0645\u0627\u0646 \u0623\u0642\u0635\u0649 \u062F\u0631\u062C\u0627\u062A \u0627\u0644\u0648\u0627\u0642\u0639\u064A\u0629\u060C \u0648\u062A\u062C\u0646\u0628 \u062A\u0645\u0627\u0645\u0627\u064B \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0635\u0648\u0631 Unsplash \u0627\u0644\u0639\u0634\u0648\u0627\u0626\u064A\u0629.

\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0643\u0648\u0646 \u0628\u0635\u064A\u063A\u0629 JSON \u062D\u0635\u0631\u064A\u0627\u064B \u0645\u0637\u0627\u0628\u0642\u0627\u064B \u0644\u0644\u0645\u062E\u0637\u0637 \u0627\u0644\u062A\u0627\u0644\u064A \u062A\u0645\u0627\u0645\u0627\u064B:
{
  "hero": {
    "id": "\u0633\u0644\u0633\u0644\u0629 \u0646\u0635\u064A\u0629 \u0641\u0631\u064A\u062F\u0629",
    "titleAr": "\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
    "titleEn": "English Title",
    "type": "movie \u0623\u0648 series",
    "rating": 8.7,
    "year": 2024,
    "duration": "\u0627\u0644\u0645\u062F\u0629",
    "genres": ["\u062A\u0635\u0646\u064A\u0641"],
    "poster": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0639\u0645\u0648\u062F\u064A\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0644\u0628\u0648\u0633\u062A\u0631 \u0645\u0646 TMDB \u0623\u0648 IMDb/Wikipedia",
    "backdrop": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0623\u0641\u0642\u064A\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0644\u062E\u0644\u0641\u064A\u0629 \u0645\u0646 TMDB \u0623\u0648 IMDb/Wikipedia",
    "storyAr": "\u0627\u0644\u0642\u0635\u0629 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
    "storyEn": "Story in English",
    "actors": ["\u0645\u0645\u062B\u0644"],
    "quality": "Ultra HD",
    "servers": [{"name": "\u0627\u0633\u0645 \u0627\u0644\u0633\u064A\u0631\u0641\u0631", "url": "\u0627\u0644\u0631\u0627\u0628\u0637"}]
  },
  "categories": [
    {
      "id": "recent",
      "titleAr": "\u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0627\u0644\u0645\u0636\u0627\u0641\u0629 \u062D\u062F\u064A\u062B\u0627\u064B",
      "titleEn": "Recently Added",
      "items": [
         {
           "id": "\u0633\u0644\u0633\u0644\u0629 \u0646\u0635\u064A\u0629 \u0641\u0631\u064A\u062F\u0629",
           "titleAr": "\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
           "titleEn": "English Title",
           "type": "movie \u0623\u0648 series",
           "rating": 8.5,
           "year": 2024,
           "duration": "\u0627\u0644\u0645\u062F\u0629",
           "genres": ["\u062A\u0635\u0646\u064A\u0641"],
           "poster": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0639\u0645\u0648\u062F\u064A\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0644\u0628\u0648\u0633\u062A\u0631 \u0645\u0646 TMDB \u0623\u0648 IMDb/Wikipedia",
           "backdrop": "\u0631\u0627\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629 \u0627\u0644\u0623\u0641\u0642\u064A\u0629 \u0627\u0644\u0631\u0633\u0645\u064A\u0629 \u0627\u0644\u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0644\u062E\u0644\u0641\u064A\u0629 \u0645\u0646 TMDB \u0623\u0648 IMDb/Wikipedia",
           "storyAr": "\u0627\u0644\u0642\u0635\u0629 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629",
           "storyEn": "Story in English",
           "actors": ["\u0645\u0645\u062B\u0644"],
           "quality": "Ultra HD",
           "servers": [{"name": "\u0627\u0633\u0645 \u0627\u0644\u0633\u064A\u0631\u0641\u0631", "url": "\u0627\u0644\u0631\u0627\u0628\u0637"}]
         }
      ]
    }
  ]
}`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          required: ["hero", "categories"],
          properties: {
            hero: {
              type: import_genai.Type.OBJECT,
              required: ["id", "titleAr", "titleEn", "type", "rating", "year", "duration", "genres", "poster", "backdrop", "storyAr", "storyEn", "actors", "quality", "servers"],
              properties: {
                id: { type: import_genai.Type.STRING },
                titleAr: { type: import_genai.Type.STRING },
                titleEn: { type: import_genai.Type.STRING },
                type: { type: import_genai.Type.STRING },
                rating: { type: import_genai.Type.NUMBER },
                year: { type: import_genai.Type.INTEGER },
                duration: { type: import_genai.Type.STRING },
                genres: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.STRING } },
                poster: { type: import_genai.Type.STRING },
                backdrop: { type: import_genai.Type.STRING },
                storyAr: { type: import_genai.Type.STRING },
                storyEn: { type: import_genai.Type.STRING },
                actors: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.STRING } },
                quality: { type: import_genai.Type.STRING },
                servers: {
                  type: import_genai.Type.ARRAY,
                  items: {
                    type: import_genai.Type.OBJECT,
                    required: ["name", "url"],
                    properties: {
                      name: { type: import_genai.Type.STRING },
                      url: { type: import_genai.Type.STRING }
                    }
                  }
                }
              }
            },
            categories: {
              type: import_genai.Type.ARRAY,
              items: {
                type: import_genai.Type.OBJECT,
                required: ["id", "titleAr", "titleEn", "items"],
                properties: {
                  id: { type: import_genai.Type.STRING },
                  titleAr: { type: import_genai.Type.STRING },
                  titleEn: { type: import_genai.Type.STRING },
                  items: {
                    type: import_genai.Type.ARRAY,
                    items: {
                      type: import_genai.Type.OBJECT,
                      required: ["id", "titleAr", "titleEn", "type", "rating", "year", "duration", "genres", "poster", "backdrop", "storyAr", "storyEn", "actors", "quality", "servers"],
                      properties: {
                        id: { type: import_genai.Type.STRING },
                        titleAr: { type: import_genai.Type.STRING },
                        titleEn: { type: import_genai.Type.STRING },
                        type: { type: import_genai.Type.STRING },
                        rating: { type: import_genai.Type.NUMBER },
                        year: { type: import_genai.Type.INTEGER },
                        duration: { type: import_genai.Type.STRING },
                        genres: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.STRING } },
                        poster: { type: import_genai.Type.STRING },
                        backdrop: { type: import_genai.Type.STRING },
                        storyAr: { type: import_genai.Type.STRING },
                        storyEn: { type: import_genai.Type.STRING },
                        actors: { type: import_genai.Type.ARRAY, items: { type: import_genai.Type.STRING } },
                        quality: { type: import_genai.Type.STRING },
                        servers: {
                          type: import_genai.Type.ARRAY,
                          items: {
                            type: import_genai.Type.OBJECT,
                            required: ["name", "url"],
                            properties: {
                              name: { type: import_genai.Type.STRING },
                              url: { type: import_genai.Type.STRING }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    const resultText = response.text?.trim();
    if (resultText) {
      cachedHomeData = JSON.parse(resultText);
      lastCacheTime = Date.now();
      console.log("[Server] Live Cinemana home categories fetched and cached successfully!");
      let hasChanges = false;
      if (cachedHomeData.hero) {
        if (!isMovieDeleted(cachedHomeData.hero.id, cachedHomeData.hero.titleAr, cachedHomeData.hero.titleEn) && !moviesDatabase.some((m) => m.id === cachedHomeData.hero.id)) {
          if (cachedHomeData.hero.isPublished === void 0) cachedHomeData.hero.isPublished = true;
          moviesDatabase.push(cachedHomeData.hero);
          saveMovieToFirestore(cachedHomeData.hero).catch(console.error);
          hasChanges = true;
        }
      }
      if (cachedHomeData.categories) {
        cachedHomeData.categories.forEach((cat) => {
          if (cat.items) {
            cat.items.forEach((item) => {
              if (!isMovieDeleted(item.id, item.titleAr, item.titleEn) && !moviesDatabase.some((m) => m.id === item.id)) {
                if (item.isPublished === void 0) item.isPublished = true;
                moviesDatabase.push(item);
                saveMovieToFirestore(item).catch(console.error);
                hasChanges = true;
              }
            });
          }
        });
      }
      if (hasChanges) {
        console.log("[Server] Persisting newly imported movies from Cinemana home to local database...");
        saveMoviesDatabase();
      }
    }
  } catch (error) {
    console.error("[Server] Error fetching live Cinemana home from Gemini:", error);
    handleGeminiError(error, "fetchHomeMoviesFromGemini");
  } finally {
    isFetchingHome = false;
  }
  return cachedHomeData;
}
async function fetchRealSeriesSeasonsFromGemini(titleEn, seriesId, backdrop, defaultRating) {
  if (!ai) return [];
  try {
    console.log(`[Gemini Series Scraper] Fetching real seasons and episodes for TV show: "${titleEn}"...`);
    const prompt = `You are an expert entertainment database manager.
Search the web (using googleSearch) for the TV show/series: "${titleEn}".
Retrieve the actual list of seasons, and for each season, retrieve the actual list of episodes (especially focusing on Season 1 and Season 2, or up to all available seasons).
For each season, provide:
- season number
- title in Arabic (e.g. "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0623\u0648\u0644", "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u062B\u0627\u0646\u064A")
- title in English (e.g. "Season 1", "Season 2")

For each episode, provide:
- episode number
- title in Arabic (e.g. "\u0648\u0631\u062B\u0629 \u0627\u0644\u062A\u0646\u064A\u0646")
- title in English (e.g. "The Heirs of the Dragon")
- duration (e.g. "59m", "45m")
- storyAr (detailed description in Arabic)
- storyEn (detailed description in English)
- rating (from 1 to 10)

For the servers list, include:
1. "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A HD" with a mock or proxy streaming link.
2. "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0630\u0643\u064A 1080p" with a mock or proxy streaming link.
Use fast sample MP4s for the stream links:
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"

Format your response as a JSON array of Seasons strictly conforming to the Season interface:
interface Episode {
  id: string; // generate unique id e.g. "s1_e1_seriesId"
  number: number;
  titleAr: string;
  titleEn: string;
  duration: string;
  storyAr: string;
  storyEn: string;
  thumbnail: string; // use this backdrop url: "${backdrop}"
  servers: { name: string; url: string }[];
  subtitlesUrlAr: string; // generate "/api/subtitles?movieId=seriesId&seasonId=seasonId&episodeId=episodeId&lang=ar"
  subtitlesUrlEn: string; // generate "/api/subtitles?movieId=seriesId&seasonId=seasonId&episodeId=episodeId&lang=en"
  rating?: number;
}
interface Season {
  id: string; // e.g. "s1", "s2"
  number: number;
  titleAr: string;
  titleEn: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  storyAr?: string;
  storyEn?: string;
  episodes: Episode[];
}

Return ONLY a valid JSON array of Season objects.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.ARRAY,
          items: {
            type: import_genai.Type.OBJECT,
            required: ["id", "number", "titleAr", "titleEn", "episodes"],
            properties: {
              id: { type: import_genai.Type.STRING },
              number: { type: import_genai.Type.INTEGER },
              titleAr: { type: import_genai.Type.STRING },
              titleEn: { type: import_genai.Type.STRING },
              episodes: {
                type: import_genai.Type.ARRAY,
                items: {
                  type: import_genai.Type.OBJECT,
                  required: ["id", "number", "titleAr", "titleEn", "duration", "storyAr", "storyEn", "thumbnail", "servers", "subtitlesUrlAr", "subtitlesUrlEn"],
                  properties: {
                    id: { type: import_genai.Type.STRING },
                    number: { type: import_genai.Type.INTEGER },
                    titleAr: { type: import_genai.Type.STRING },
                    titleEn: { type: import_genai.Type.STRING },
                    duration: { type: import_genai.Type.STRING },
                    storyAr: { type: import_genai.Type.STRING },
                    storyEn: { type: import_genai.Type.STRING },
                    thumbnail: { type: import_genai.Type.STRING },
                    servers: {
                      type: import_genai.Type.ARRAY,
                      items: {
                        type: import_genai.Type.OBJECT,
                        required: ["name", "url"],
                        properties: {
                          name: { type: import_genai.Type.STRING },
                          url: { type: import_genai.Type.STRING }
                        }
                      }
                    },
                    subtitlesUrlAr: { type: import_genai.Type.STRING },
                    subtitlesUrlEn: { type: import_genai.Type.STRING },
                    rating: { type: import_genai.Type.NUMBER }
                  }
                }
              }
            }
          }
        }
      }
    });
    const resultText = response.text?.trim();
    if (resultText) {
      const seasons = JSON.parse(resultText);
      if (Array.isArray(seasons) && seasons.length > 0) {
        console.log(`[Gemini Series Scraper] Successfully retrieved ${seasons.length} real seasons for "${titleEn}"!`);
        return seasons;
      }
    }
  } catch (err) {
    console.error(`[Gemini Series Scraper] Failed to fetch real seasons for "${titleEn}":`, err.message || err);
  }
  return [];
}
async function fetchFutureAndTrendingTitlesFromGemini() {
  if (!ai || Date.now() < quotaExceededUntil) return [];
  try {
    console.log("[TMDB Auto-Seeder] Searching live web for newly released 2026 movies and series on Cinemana/IMDb...");
    const prompt = `You are an expert movie data harvester.
Search the web (using googleSearch) for the newest and recently released movies and TV series published in 2026 on Cinemana Shabakaty (\u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0634\u0628\u0643\u062A\u064A) and IMDb/TMDB.
List the top 20 most recent blockbusters, trending TV shows, and newly added releases of 2026.
Return your response as a simple JSON array of strings containing ONLY the titles in English (e.g., ["Dune: Part Two", "Gladiator II", "Inside Out 2", "Wicked", "Moana 2", "Severance Season 2"]).`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.ARRAY,
          items: { type: import_genai.Type.STRING }
        }
      }
    });
    const resultText = response.text?.trim();
    if (resultText) {
      const titles = JSON.parse(resultText);
      if (Array.isArray(titles) && titles.length > 0) {
        console.log(`[TMDB Auto-Seeder] Discovered ${titles.length} newly released titles from live web:`, titles);
        return titles;
      }
    }
  } catch (err) {
    handleGeminiError(err, "fetchFutureAndTrendingTitlesFromGemini");
    console.warn("[TMDB Auto-Seeder] Could not discover new titles from Gemini web search (using popular list instead):", err.message || err);
  }
  return [];
}
var isSeedingReal = false;
async function seedRealMoviesFromTMDB() {
  if (isSeedingReal) {
    console.log("[TMDB Auto-Seeder] Seeding is already in progress. Skipping duplicate call.");
    return;
  }
  isSeedingReal = true;
  console.log("[Server] Starting background seeding of real movies and series from TMDB...");
  const POPULAR_TITLES_TO_IMPORT = [
    // Latest Blockbusters & Trending
    "Deadpool & Wolverine",
    "Inside Out 2",
    "Dune: Part Two",
    "Oppenheimer",
    "Gladiator II",
    "Alien: Romulus",
    "Moana 2",
    "Wicked",
    "Kingdom of the Planet of the Apes",
    "The Batman",
    "Bad Boys: Ride or Die",
    "A Quiet Place: Day One",
    "Despicable Me 4",
    "Twisters",
    "Spider-Man: Across the Spider-Verse",
    "John Wick: Chapter 4",
    "Top Gun: Maverick",
    "Everything Everywhere All at Once",
    "Avatar: The Way of Water",
    "The Lord of the Rings: The Return of the King",
    "Avengers: Endgame",
    "Inception",
    "Interstellar",
    "The Dark Knight",
    "Fight Club",
    "The Godfather",
    "Pulp Fiction",
    "Barbie",
    // Top TV Shows / Series
    "House of the Dragon",
    "The Last of Us",
    "Squid Game",
    "The Boys",
    "Shogun",
    "Fallout",
    "Stranger Things",
    "Breaking Bad",
    "Game of Thrones",
    "Succession",
    "Loki",
    "The Bear",
    "Chernobyl",
    "Severance",
    "The Mandalorian",
    "Wednesday",
    "Dark",
    "Prison Break",
    "Vikings",
    "Peaky Blinders"
  ];
  const newlyReleasedDiscovered = await fetchFutureAndTrendingTitlesFromGemini().catch(() => []);
  const ALL_TITLES_TO_IMPORT = Array.from(/* @__PURE__ */ new Set([...newlyReleasedDiscovered, ...POPULAR_TITLES_TO_IMPORT]));
  let addedCount = 0;
  for (const title of ALL_TITLES_TO_IMPORT) {
    try {
      if (isMovieDeleted(void 0, title, title)) {
        console.log(`[TMDB Auto-Seeder] Skipping deleted work title: "${title}"`);
        continue;
      }
      const exists = moviesDatabase.some(
        (m) => m.titleEn.toLowerCase() === title.toLowerCase() || m.titleAr && m.titleAr.toLowerCase() === title.toLowerCase()
      );
      if (exists) {
        continue;
      }
      console.log(`[TMDB Auto-Seeder] Scraping details for work: "${title}"...`);
      const movieData = await scrapeTMDBMetadata(title);
      if (movieData && movieData.titleEn) {
        if (isMovieDeleted(movieData.id, movieData.titleAr, movieData.titleEn)) {
          console.log(`[TMDB Auto-Seeder] Skipping deleted scraped work: "${movieData.titleAr}" / "${movieData.titleEn}"`);
          continue;
        }
        if (!moviesDatabase.some((m) => m.id === movieData.id)) {
          movieData.isPublished = true;
          moviesDatabase.push(movieData);
          await saveMovieToFirestore(movieData).catch((err) => console.error(`[TMDB Auto-Seeder] Error saving ${movieData.id} to Firestore:`, err));
          addedCount++;
          console.log(`[TMDB Auto-Seeder] Successfully imported: [${movieData.type}] ${movieData.titleAr} / ${movieData.titleEn}`);
          if (addedCount % 2 === 0) {
            saveMoviesDatabase();
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error(`[TMDB Auto-Seeder] Failed to auto-seed "${title}":`, err.message || err);
    }
  }
  isSeedingReal = false;
  if (addedCount > 0) {
    saveMoviesDatabase();
    console.log(`[TMDB Auto-Seeder] Background seeding completed. Added ${addedCount} brand new real movies/series!`);
  } else {
    console.log("[TMDB Auto-Seeder] All popular movies and series are already in the database.");
  }
}
async function findOfficialWikipediaPoster(title, isBackdrop) {
  const cleanTitle = title.replace(/[^\w\s\u0600-\u06FF]/gi, "").trim();
  if (!cleanTitle) return null;
  const languages = ["en", "ar"];
  for (const lang of languages) {
    try {
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTitle)}&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(2e3) });
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      let pageTitle = "";
      if (searchData.query?.search?.length > 0) {
        const results = searchData.query.search;
        const bestResult = results.find((item) => {
          const t = item.title.toLowerCase();
          const s = item.snippet?.toLowerCase() || "";
          return t.includes("film") || t.includes("movie") || t.includes("series") || t.includes("show") || t.includes("\u0641\u064A\u0644\u0645") || t.includes("\u0645\u0633\u0644\u0633\u0644") || s.includes("film") || s.includes("movie") || s.includes("series") || s.includes("show") || s.includes("\u0641\u064A\u0644\u0645") || s.includes("\u0645\u0633\u0644\u0633\u0644");
        }) || results[0];
        pageTitle = bestResult.title;
      } else {
        pageTitle = cleanTitle;
      }
      const imageQueryUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=1000&origin=*`;
      const imageRes = await fetch(imageQueryUrl, { signal: AbortSignal.timeout(2e3) });
      if (imageRes.ok) {
        const imageData = await imageRes.json();
        const pages = imageData.query?.pages;
        if (pages) {
          const pageId = Object.keys(pages)[0];
          const thumbnail = pages[pageId]?.thumbnail?.source;
          if (thumbnail && thumbnail.startsWith("http")) {
            console.log(`[Wikipedia Poster API] Found official pageimage for "${title}" (${lang}): ${thumbnail}`);
            return thumbnail;
          }
        }
      }
      try {
        const parseUrl = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=0&format=json&origin=*`;
        const parseRes = await fetch(parseUrl, { signal: AbortSignal.timeout(2500) });
        if (parseRes.ok) {
          const parseData = await parseRes.json();
          const html = parseData.parse?.text?.["*"];
          if (html) {
            const imgRegex = /<img[^>]+src="([^"]+)"/gi;
            let match;
            const foundUrls = [];
            while ((match = imgRegex.exec(html)) !== null) {
              let src = match[1];
              if (src.startsWith("//")) {
                src = "https:" + src;
              }
              if (src.includes("upload.wikimedia.org") && !src.includes("Symbol") && !src.includes("Wiki") && !src.includes("Edit") && !src.includes("sound")) {
                foundUrls.push(src);
              }
            }
            if (foundUrls.length > 0) {
              const thumbUrl = foundUrls[0];
              let finalUrl = thumbUrl;
              if (thumbUrl.includes("/thumb/")) {
                let clean = thumbUrl.replace("/thumb/", "/");
                const lastSlash = clean.lastIndexOf("/");
                if (lastSlash !== -1) {
                  clean = clean.substring(0, lastSlash);
                }
                finalUrl = clean;
              }
              console.log(`[Wikipedia Poster API] Successfully extracted parsed infobox poster for "${title}" (${lang}): ${finalUrl}`);
              return finalUrl;
            }
          }
        }
      } catch (parseErr) {
        console.warn(`[Wikipedia Poster API] Parse infobox section 0 fallback failed for "${title}":`, parseErr);
      }
    } catch (err) {
      console.warn(`[Wikipedia Poster API] Failed for "${title}" in ${lang}:`, err);
    }
  }
  return null;
}
function clearMissingUploadedSubtitle(url) {
  if (!url || !url.startsWith("/uploads/")) return url;
  const filePath = import_path2.default.join(process.cwd(), "uploads", import_path2.default.basename(url));
  return import_fs.default.existsSync(filePath) ? url : "";
}
function getValidSubtitleUrl(url, movieId, lang, seasonId, episodeId, movieOrEp, isEditMode = false) {
  if (url === "" || url === "none") {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.subtitlesUrlAr = "";
        movieOrEp.originalSubtitlesUrlAr = "";
      } else {
        movieOrEp.subtitlesUrlEn = "";
        movieOrEp.originalSubtitlesUrlEn = "";
      }
    }
    return "";
  }
  if (url === void 0 || url === null) {
    if (isEditMode) return "";
    let path3 = `/api/subtitles?movieId=${movieId}`;
    if (seasonId) path3 += `&seasonId=${seasonId}`;
    if (episodeId) path3 += `&episodeId=${episodeId}`;
    path3 += `&lang=${lang}`;
    return path3;
  }
  if (url.startsWith("/uploads/") || url.startsWith("data:") || url.startsWith("blob:")) {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.originalSubtitlesUrlAr = url;
        movieOrEp.subtitlesUrlAr = url;
      } else {
        movieOrEp.originalSubtitlesUrlEn = url;
        movieOrEp.subtitlesUrlEn = url;
      }
    }
    return url;
  }
  if (url.startsWith("/api/subtitles?")) {
    return url;
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.originalSubtitlesUrlAr = url;
      } else {
        movieOrEp.originalSubtitlesUrlEn = url;
      }
    }
    return url;
  }
  return url;
}
async function fetchOfficialTMDBImages(title) {
  try {
    const cleanTitle = title.replace(/\((?:19|20)\d{2}\)/g, "").replace(/[()]/g, "").replace(/[-:_]/g, " ").trim();
    console.log(`[TMDB] Searching for title: "${cleanTitle}" (originally "${title}")`);
    const hit = await searchMulti(cleanTitle);
    if (!hit) {
      console.log(`[TMDB] No search match for: "${cleanTitle}"`);
      return null;
    }
    const details = hit.mediaType === "movie" ? await getMovieDetails(hit.id) : await getTvDetails(hit.id);
    if (!details) return null;
    const poster = posterUrl(details.poster_path);
    const backdrop = backdropUrl(details.backdrop_path);
    if (!poster && !backdrop) {
      console.log(`[TMDB] No poster/backdrop available for: "${cleanTitle}"`);
      return null;
    }
    return { poster, backdrop };
  } catch (err) {
    console.error("[TMDB] Image lookup failed:", err);
    return null;
  }
}
async function fetchPersonPhotoWithGemini(name) {
  if (!ai || Date.now() < quotaExceededUntil) return null;
  try {
    console.log(`[Healer] Using Gemini Search Grounding to find official photo for: "${name}"`);
    const prompt = `Search Google and find the official TMDB (The Movie Database) profile picture URL or IMDb profile picture URL for the filmmaker or actor: "${name}".
You must return a direct, publicly accessible, high-quality portrait/headshot image URL of this person. 
Prefer links from TMDB (e.g., starting with https://image.tmdb.org/t/p/) or IMDb (e.g., starting with https://m.media-amazon.com/images/M/).
The response must be exclusively the raw URL string of the image, with no markdown code blocks, quotes, or conversational text.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    const url = response.text?.trim().replace(/`/g, "").replace(/"/g, "").replace(/'/g, "");
    if (url && (url.startsWith("http://") || url.startsWith("https://")) && (url.includes(".jpg") || url.includes(".png") || url.includes(".jpeg") || url.includes("image.tmdb.org") || url.includes("media-amazon.com"))) {
      console.log(`[Healer] Gemini Search Grounding found official photo for "${name}": ${url}`);
      return url;
    }
  } catch (err) {
    handleGeminiError(err, "fetchPersonPhotoWithGemini");
    console.warn(`[Healer] Gemini Search Grounding lookup paused for "${name}":`, err.message || err);
  }
  return null;
}
async function fetchOfficialTMDBPersonPhoto(name) {
  try {
    const cleanName = name.replace(/[()]/g, "").trim();
    const hit = await searchPerson(cleanName);
    const photoUrl = hit?.profilePath ? profileUrl(hit.profilePath) : null;
    if (photoUrl) {
      console.log(`[TMDB] Found official photo for "${cleanName}": ${photoUrl}`);
      return photoUrl;
    }
    console.log(`[TMDB] No person photo found via API for: "${cleanName}"`);
  } catch (err) {
    console.error(`[TMDB] Failed to fetch photo for "${name}":`, err);
  }
  return await fetchPersonPhotoWithGemini(name);
}
function getInitialsAvatar(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1c1917&color=a1a1aa&size=128&bold=true&font-size=0.33`;
}
async function verifyAndCorrectPersonPhotoUrl(name, url) {
  const isGeneric = !url || url.trim() === "" || url === "0" || url === "null" || url.includes("unsplash.com") || url.includes("placeholder") || url.includes("example.com") || url.includes("ui-avatars.com/api");
  let isBroken = false;
  if (!isGeneric && url && (url.startsWith("http://") || url.startsWith("https://"))) {
    try {
      const checkRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2e3) });
      if (checkRes.status === 404) {
        isBroken = true;
      }
    } catch (err) {
      try {
        const getRes = await fetch(url, { method: "GET", headers: { "Range": "bytes=0-10" }, signal: AbortSignal.timeout(2e3) });
        if (getRes.status === 404) {
          isBroken = true;
        }
      } catch (err2) {
      }
    }
  }
  if (isGeneric || isBroken) {
    console.log(`[Healer] Person photo URL for "${name}" is ${isGeneric ? "generic" : "broken"}. Attempting correction...`);
    const tmdbPhoto = await fetchOfficialTMDBPersonPhoto(name);
    if (tmdbPhoto) {
      console.log(`[Healer] Corrected person photo with TMDB scraper: ${tmdbPhoto}`);
      return tmdbPhoto;
    }
    return getInitialsAvatar(name);
  }
  return url;
}
function formatTmdbRuntime(minutes) {
  if (!minutes || minutes <= 0) return "45m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
async function fetchTMDBSeriesSeasons(tmdbId, seriesTitleEn, seriesTitleAr, backdrop, defaultRating) {
  try {
    const seasons = [];
    console.log(`[TMDB] Fetching season listings for TV ID: ${tmdbId}`);
    for (let sNum = 1; sNum <= 5; sNum++) {
      const enSeason = await getTvSeasonDetails(tmdbId, sNum, "en-US");
      if (!enSeason) break;
      const arSeason = await getTvSeasonDetails(tmdbId, sNum, "ar");
      const seasonId = `s${sNum}`;
      const episodes = (enSeason.episodes ?? []).map((ep) => {
        const epNum = ep.episode_number;
        const arEp = arSeason?.episodes?.find((e) => e.episode_number === epNum);
        const epTitleEn = ep.name?.trim() || `Episode ${epNum}`;
        const epTitleAr = arEp?.name?.trim() && /[\u0600-\u06FF]/.test(arEp.name) ? arEp.name.trim() : `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum}`;
        const epStoryEn = ep.overview?.trim() || `Details and plot of Episode ${epNum} of Season ${sNum} of ${seriesTitleEn}.`;
        const epStoryAr = arEp?.overview?.trim() && /[\u0600-\u06FF]/.test(arEp.overview) ? arEp.overview.trim() : `\u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u062D\u0644\u0642\u0629 ${epNum} \u0645\u0646 \u0645\u0633\u0644\u0633\u0644 ${seriesTitleAr}.`;
        const thumbnail = tmdbImageUrl(ep.still_path, "w300") || backdrop;
        const epId = `s${sNum}_e${epNum}_${tmdbId}`;
        return {
          id: epId,
          number: epNum,
          titleAr: epTitleAr,
          titleEn: epTitleEn,
          duration: formatTmdbRuntime(ep.runtime),
          storyAr: epStoryAr,
          storyEn: epStoryEn,
          thumbnail,
          servers: [
            { name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
          ],
          subtitlesUrlAr: `/api/subtitles?movieId=series_${tmdbId}&seasonId=${seasonId}&episodeId=${epId}&lang=ar`,
          subtitlesUrlEn: `/api/subtitles?movieId=series_${tmdbId}&seasonId=${seasonId}&episodeId=${epId}&lang=en`,
          rating: defaultRating
        };
      });
      if (episodes.length > 0) {
        const seasonYear = enSeason.air_date ? parseInt(String(enSeason.air_date).slice(0, 4), 10) : (/* @__PURE__ */ new Date()).getFullYear();
        seasons.push({
          id: seasonId,
          number: sNum,
          titleAr: arSeason?.name?.trim() && /[\u0600-\u06FF]/.test(arSeason.name) ? arSeason.name.trim() : `\u0627\u0644\u0645\u0648\u0633\u0645 ${sNum}`,
          titleEn: enSeason.name?.trim() || `Season ${sNum}`,
          poster: posterUrl(enSeason.poster_path) || backdrop,
          backdrop,
          year: seasonYear,
          storyAr: arSeason?.overview?.trim() && /[\u0600-\u06FF]/.test(arSeason.overview) ? arSeason.overview.trim() : `\u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u0645\u0648\u0633\u0645 ${sNum} \u0645\u0646 \u0645\u0633\u0644\u0633\u0644 ${seriesTitleAr}.`,
          storyEn: enSeason.overview?.trim() || `Season ${sNum} of ${seriesTitleEn}`,
          episodes
        });
      }
    }
    return seasons;
  } catch (err) {
    console.warn(`[TMDB] Failed to fetch seasons for TV ${tmdbId}:`, err.message);
    return [];
  }
}
var TMDB_COUNTRY_MAP = {
  "US": "\u0627\u0644\u0648\u0644\u0627\u064A\u0627\u062A \u0627\u0644\u0645\u062A\u062D\u062F\u0629",
  "GB": "\u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0645\u062A\u062D\u062F\u0629",
  "FR": "\u0641\u0631\u0646\u0633\u0627",
  "DE": "\u0623\u0644\u0645\u0627\u0646\u064A\u0627",
  "IT": "\u0625\u064A\u0637\u0627\u0644\u064A\u0627",
  "ES": "\u0625\u0633\u0628\u0627\u0646\u064A\u0627",
  "KR": "\u0643\u0648\u0631\u064A\u0627 \u0627\u0644\u062C\u0646\u0648\u0628\u064A\u0629",
  "JP": "\u0627\u0644\u064A\u0627\u0628\u0627\u0646",
  "CN": "\u0627\u0644\u0635\u064A\u0646",
  "HK": "\u0647\u0648\u0646\u063A \u0643\u0648\u0646\u063A",
  "TW": "\u062A\u0627\u064A\u0648\u0627\u0646",
  "IN": "\u0627\u0644\u0647\u0646\u062F",
  "TR": "\u062A\u0631\u0643\u064A\u0627",
  "EG": "\u0645\u0635\u0631",
  "SA": "\u0627\u0644\u0633\u0639\u0648\u062F\u064A\u0629",
  "AE": "\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062A",
  "LB": "\u0644\u0628\u0646\u0627\u0646",
  "IQ": "\u0627\u0644\u0639\u0631\u0627\u0642",
  "SY": "\u0633\u0648\u0631\u064A\u0627",
  "JO": "\u0627\u0644\u0623\u0631\u062F\u0646",
  "KW": "\u0627\u0644\u0643\u0648\u064A\u062A",
  "QA": "\u0642\u0637\u0631",
  "BH": "\u0627\u0644\u0628\u062D\u0631\u064A\u0646",
  "OM": "\u0639\u0645\u0627\u0646",
  "MA": "\u0627\u0644\u0645\u063A\u0631\u0628",
  "TN": "\u062A\u0648\u0646\u0633",
  "DZ": "\u0627\u0644\u062C\u0632\u0627\u0626\u0631",
  "LY": "\u0644\u064A\u0628\u064A\u0627",
  "SD": "\u0627\u0644\u0633\u0648\u062F\u0627\u0646",
  "PS": "\u0641\u0644\u0633\u0637\u064A\u0646",
  "YE": "\u0627\u0644\u064A\u0645\u0646",
  "CA": "\u0643\u0646\u062F\u0627",
  "AU": "\u0623\u0633\u062A\u0631\u0627\u0644\u064A\u0627",
  "NZ": "\u0646\u064A\u0648\u0632\u064A\u0644\u0646\u062F\u0627",
  "RU": "\u0631\u0648\u0633\u064A\u0627",
  "BR": "\u0627\u0644\u0628\u0631\u0627\u0632\u064A\u0644",
  "MX": "\u0627\u0644\u0645\u0643\u0633\u064A\u0643",
  "AR": "\u0627\u0644\u0623\u0631\u062C\u0646\u062A\u064A\u0646",
  "SE": "\u0627\u0644\u0633\u0648\u064A\u062F",
  "NO": "\u0627\u0644\u0646\u0631\u0648\u064A\u062C",
  "DK": "\u0627\u0644\u062F\u0646\u0645\u0627\u0631\u0643",
  "FI": "\u0641\u0646\u0644\u0646\u062F\u0627",
  "NL": "\u0647\u0648\u0644\u0646\u062F\u0627",
  "BE": "\u0628\u0644\u062C\u064A\u0643\u0627",
  "CH": "\u0633\u0648\u064A\u0633\u0631\u0627",
  "AT": "\u0627\u0644\u0646\u0645\u0633\u0627",
  "IE": "\u0623\u064A\u0631\u0644\u0646\u062F\u0627",
  "PT": "\u0627\u0644\u0628\u0631\u062A\u063A\u0627\u0644",
  "GR": "\u0627\u0644\u064A\u0648\u0646\u0627\u0646",
  "PL": "\u0628\u0648\u0644\u0646\u062F\u0627",
  "TH": "\u062A\u0627\u064A\u0644\u0627\u0646\u062F",
  "ID": "\u0625\u0646\u062F\u0648\u0646\u064A\u0633\u064A\u0627",
  "PH": "\u0627\u0644\u0641\u0644\u0628\u064A\u0646",
  "MY": "\u0645\u0627\u0644\u064A\u0632\u064A\u0627",
  "SG": "\u0633\u0646\u063A\u0627\u0641\u0648\u0631\u0629",
  "IL": "\u0625\u0633\u0631\u0627\u0626\u064A\u0644",
  "IR": "\u0625\u064A\u0631\u0627\u0646",
  "PK": "\u0628\u0627\u0643\u0633\u062A\u0627\u0646",
  "NG": "\u0646\u064A\u062C\u064A\u0631\u064A\u0627",
  "ZA": "\u062C\u0646\u0648\u0628 \u0623\u0641\u0631\u064A\u0642\u064A\u0627"
};
async function scrapeTMDBMetadata(searchQueryOrUrl, lang = "ar") {
  try {
    let query = searchQueryOrUrl.trim();
    const isUrl = query.startsWith("http://") || query.startsWith("https://");
    let tmdbId = null;
    let mediaType = null;
    const directPathMatch = query.match(/\/?(movie|tv)\/(\d+)/i);
    if (directPathMatch) {
      mediaType = directPathMatch[1].toLowerCase();
      tmdbId = directPathMatch[2];
    } else if (isUrl && query.includes("imdb.com")) {
      const imdbMatch = query.match(/title\/(tt\d+)/);
      if (imdbMatch) {
        const hit = await findByImdbId(imdbMatch[1]);
        if (hit) {
          tmdbId = hit.id;
          mediaType = hit.mediaType;
        }
      }
    }
    if (!tmdbId) {
      const cleanTitle = query.replace(/\((?:19|20)\d{2}\)/g, "").replace(/[()]/g, "").replace(/[-:_]/g, " ").trim();
      console.log(`[TMDB] Searching for: "${cleanTitle}"`);
      const hit = await searchMulti(cleanTitle);
      if (!hit) {
        throw new Error(`No movie or show found on TMDB for: "${cleanTitle}"`);
      }
      tmdbId = hit.id;
      mediaType = hit.mediaType;
    }
    const type = mediaType === "tv" ? "series" : "movie";
    console.log(`[TMDB] Fetching details for ${mediaType} ${tmdbId} (Type: ${type})`);
    const details = mediaType === "tv" ? await getTvDetails(tmdbId) : await getMovieDetails(tmdbId);
    if (!details) {
      throw new Error(`Failed to fetch TMDB details for ${mediaType} ${tmdbId}`);
    }
    const arDetails = mediaType === "tv" ? await getTvArabic(tmdbId) : await getMovieArabic(tmdbId);
    const titleEn = (mediaType === "tv" ? details.name : details.title)?.trim() || "Untitled Movie";
    const storyEn = details.overview?.trim() || "";
    const arTitleRaw = (mediaType === "tv" ? arDetails?.name : arDetails?.title)?.trim();
    const titleAr = arTitleRaw && /[؀-ۿ]/.test(arTitleRaw) ? arTitleRaw : titleEn;
    const arOverviewRaw = arDetails?.overview?.trim();
    const storyAr = arOverviewRaw && /[؀-ۿ]/.test(arOverviewRaw) ? arOverviewRaw : `\u062A\u062F\u0648\u0631 \u0623\u062D\u062F\u0627\u062B \u0641\u064A\u0644\u0645 ${titleAr || titleEn} \u062D\u0648\u0644 \u0642\u0635\u0629 \u0645\u062B\u064A\u0631\u0629 \u0645\u0644\u064A\u0626\u0629 \u0628\u0627\u0644\u0623\u062D\u062F\u0627\u062B \u0648\u0627\u0644\u062A\u0634\u0648\u064A\u0642 \u0648\u0627\u0644\u0645\u063A\u0627\u0645\u0631\u0629.`;
    const releaseDate = mediaType === "tv" ? details.first_air_date : details.release_date;
    const year = releaseDate ? parseInt(String(releaseDate).slice(0, 4), 10) : (/* @__PURE__ */ new Date()).getFullYear();
    const rating = details.vote_average ? parseFloat(details.vote_average.toFixed(1)) : 8;
    const genreMap = {
      "Action": "\u0623\u0643\u0634\u0646",
      "Adventure": "\u0645\u063A\u0627\u0645\u0631\u0629",
      "Science Fiction": "\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A",
      "Sci-Fi": "\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A",
      "Drama": "\u062F\u0631\u0627\u0645\u0627",
      "Comedy": "\u0643\u0648\u0645\u064A\u062F\u064A\u0627",
      "Thriller": "\u062A\u0634\u0648\u064A\u0642",
      "Horror": "\u0631\u0639\u0628",
      "Crime": "\u062C\u0631\u064A\u0645\u0629",
      "Documentary": "\u0648\u062B\u0627\u0626\u0642\u064A",
      "Family": "\u0639\u0627\u0626\u0644\u064A",
      "Fantasy": "\u062E\u064A\u0627\u0644",
      "Mystery": "\u062A\u0634\u0648\u064A\u0642",
      "Romance": "\u062F\u0631\u0627\u0645\u0627",
      "Animation": "\u0639\u0627\u0626\u0644\u064A"
    };
    const genres = [];
    for (const g of details.genres ?? []) {
      const mapped = genreMap[g.name];
      if (mapped && !genres.includes(mapped)) genres.push(mapped);
    }
    if (genres.length === 0) genres.push("\u062F\u0631\u0627\u0645\u0627", "\u062A\u0634\u0648\u064A\u0642");
    const language = details.original_language || "en";
    const prodCountries = details.production_countries ?? [];
    const country = prodCountries.length > 0 ? TMDB_COUNTRY_MAP[prodCountries[0].iso_3166_1] || prodCountries[0].name : "";
    const rawPoster = posterUrl(details.poster_path) || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
    const rawBackdrop = backdropUrl(details.backdrop_path) || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=3840&q=95&auto=format&fit=crop";
    const logoPath = details.images?.logos?.[0]?.file_path;
    const logoUrl2 = logoUrl(logoPath) || "";
    const crew = details.credits?.crew ?? [];
    const cast = details.credits?.cast ?? [];
    let director = "";
    let directorPhotoUrl = "";
    if (mediaType === "tv" && details.created_by && details.created_by.length > 0) {
      director = details.created_by[0].name;
      directorPhotoUrl = profileUrl(details.created_by[0].profile_path) || "";
    } else {
      const dirCrew = crew.find((c) => {
        const job = (c.job || "").toLowerCase();
        return job === "director" || job === "creator";
      });
      if (dirCrew) {
        director = dirCrew.name;
        directorPhotoUrl = profileUrl(dirCrew.profile_path) || "";
      }
    }
    let writer = "";
    let writerPhotoUrl = "";
    const writerCrew = crew.find((c) => {
      const job = (c.job || "").toLowerCase();
      return job.includes("writer") || job.includes("screenplay") || job.includes("story") || job.includes("author");
    });
    if (writerCrew) {
      writer = writerCrew.name;
      writerPhotoUrl = profileUrl(writerCrew.profile_path) || "";
    }
    directorPhotoUrl = director ? await verifyAndCorrectPersonPhotoUrl(director, directorPhotoUrl) : "";
    writerPhotoUrl = writer ? await verifyAndCorrectPersonPhotoUrl(writer, writerPhotoUrl) : "";
    const castMembers = [];
    for (const c of cast.slice(0, 12)) {
      const name = c.name?.trim();
      if (!name || name.includes("TMDB")) continue;
      const role = c.character?.trim() || (lang === "ar" ? "\u0645\u0645\u062B\u0644" : "Actor");
      const photoUrl = await verifyAndCorrectPersonPhotoUrl(name, profileUrl(c.profile_path) || "");
      castMembers.push({ name, role, photoUrl });
    }
    const actors = castMembers.slice(0, 5).map((c) => c.name);
    if (actors.length === 0) actors.push("Leo Woodall", "Dustin Hoffman", "Jean Smart", "Lior Raz");
    if (castMembers.length === 0) {
      for (const actorName of actors) {
        const photoUrl = await verifyAndCorrectPersonPhotoUrl(actorName, "");
        castMembers.push({
          name: actorName,
          role: lang === "ar" ? "\u0645\u0645\u062B\u0644 \u0631\u0626\u064A\u0633\u064A" : "Main Cast",
          photoUrl
        });
      }
    }
    const duration = mediaType === "tv" ? "45m" : details.runtime ? formatTmdbRuntime(details.runtime) : "1h 50m";
    let ageRating = "";
    if (mediaType === "tv") {
      const usRating = details.content_ratings?.results?.find((r) => r.iso_3166_1 === "US");
      if (usRating?.rating) ageRating = usRating.rating;
    } else {
      const usRelease = details.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
      const cert = usRelease?.release_dates?.find((rd) => rd.certification)?.certification;
      if (cert) ageRating = cert;
    }
    if (!ageRating) ageRating = rating >= 8.5 ? "TV-MA" : "PG-13";
    const trailer = (details.videos?.results ?? []).find((v) => v.site === "YouTube" && v.type === "Trailer");
    const trailerUrl = trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(titleEn + " trailer")}`;
    const poster = await verifyAndCorrectImageUrl(rawPoster, titleEn, false, genres);
    const backdrop = await verifyAndCorrectImageUrl(rawBackdrop, titleEn, true, genres);
    const tempMovieId = type === "series" ? `series_${tmdbId}` : `movie_${tmdbId}`;
    const result = {
      id: tempMovieId,
      titleAr,
      titleEn,
      type,
      rating,
      year,
      duration,
      ageRating,
      genres,
      language,
      country,
      poster,
      backdrop,
      logoUrl: logoUrl2,
      storyAr,
      storyEn,
      actors,
      director,
      writer,
      directorPhotoUrl,
      writerPhotoUrl,
      castMembers,
      quality: "Full HD",
      trailerUrl,
      servers: [
        { name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
      ],
      subtitlesUrlAr: `/api/subtitles?movieId=${tempMovieId}&lang=ar`,
      subtitlesUrlEn: `/api/subtitles?movieId=${tempMovieId}&lang=en`
    };
    try {
      console.log(`[TMDB] Searching live subtitles for: "${titleEn}" (${year})...`);
      const subs = await findSubtitlesForWork(titleEn, year, type);
      if (subs && (subs.ar || subs.en)) {
        if (subs.ar) {
          result.originalSubtitlesUrlAr = subs.ar;
        }
        if (subs.en) {
          result.originalSubtitlesUrlEn = subs.en;
        }
        console.log(`[TMDB] Found & attached subtitles: AR=${subs.ar || "none"}, EN=${subs.en || "none"}`);
      }
    } catch (subErr) {
      console.warn("[TMDB] Subtitle auto-lookup failed during import:", subErr.message || subErr);
    }
    if (type === "series") {
      const scrapedSeasons = await fetchTMDBSeriesSeasons(String(tmdbId), titleEn, titleAr, backdrop, rating);
      if (scrapedSeasons && scrapedSeasons.length > 0) {
        result.seasons = scrapedSeasons;
      } else {
        const realSeasons = await fetchRealSeriesSeasonsFromGemini(titleEn, tempMovieId, backdrop, rating);
        if (realSeasons && realSeasons.length > 0) {
          result.seasons = realSeasons;
        } else {
          const sId = "s1";
          result.seasons = [
            {
              id: sId,
              number: 1,
              titleAr: "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0623\u0648\u0644",
              titleEn: "Season 1",
              episodes: Array.from({ length: 10 }).map((_, i) => {
                const epNum = i + 1;
                const epId = `s1_e${epNum}_${tmdbId}`;
                return {
                  id: epId,
                  number: epNum,
                  titleAr: `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum}`,
                  titleEn: `Episode ${epNum}`,
                  duration: "45m",
                  storyAr: `\u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u062D\u0644\u0642\u0629 ${epNum} \u0645\u0646 \u0645\u0633\u0644\u0633\u0644 \u0627\u0644\u062A\u0634\u0648\u064A\u0642 \u0648\u0627\u0644\u0625\u062B\u0627\u0631\u0629 ${titleAr}.`,
                  storyEn: `Details and plot of Episode ${epNum} of Season 1 of ${titleEn}.`,
                  thumbnail: backdrop,
                  servers: [
                    { name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
                  ],
                  subtitlesUrlAr: `/api/subtitles?movieId=${result.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
                  subtitlesUrlEn: `/api/subtitles?movieId=${result.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
                  rating
                };
              })
            }
          ];
        }
      }
    }
    return result;
  } catch (err) {
    if (err.message && err.message.includes("429")) {
      console.warn("[TMDB] Rate-limited (429). Falling back gracefully.");
    } else {
      console.error("[TMDB] Comprehensive metadata fetch failed:", err.message);
    }
    return null;
  }
}
async function verifyAndCorrectImageUrl(url, title, isBackdrop, genres) {
  if (url && url.includes("image.tmdb.org")) {
    if (isBackdrop) {
      return url.replace(/\/t\/p\/(w500|w300|w185|w780|w1280|1920_and_h800_multi_faces|1000_and_h563_multi_faces)\//, "/t/p/original/");
    } else {
      return url.replace(/\/t\/p\/(w500|w300|w185|w154|w92|w342)\//, "/t/p/w780/");
    }
  }
  if (url && url.includes("images.unsplash.com")) {
    return url.replace(/w=\d+/, isBackdrop ? "w=3840" : "w=1920").replace(/q=\d+/, "q=95");
  }
  const defaultPoster = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
  const defaultBackdrop = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=3840&q=95&auto=format&fit=crop";
  const genreStr = genres && genres.length > 0 ? genres.join(", ") : "";
  const isGeneric = !url || url.trim() === "" || url === "0" || url === "null" || url.includes("unsplash.com") || url.includes("placeholder") || url.includes("example.com");
  let isBroken = false;
  if (!isGeneric && url && (url.startsWith("http://") || url.startsWith("https://"))) {
    try {
      const checkRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2e3) });
      if (checkRes.status === 404) {
        isBroken = true;
      }
    } catch (err) {
      try {
        const getRes = await fetch(url, { method: "GET", headers: { "Range": "bytes=0-10" }, signal: AbortSignal.timeout(2e3) });
        if (getRes.status === 404) {
          isBroken = true;
        }
      } catch (err2) {
      }
    }
  }
  if (isGeneric || isBroken) {
    console.log(`[Healer] Image URL for "${title}" is ${isGeneric ? "generic/placeholder" : "broken"}: "${url}". Attempting radical correction...`);
    try {
      const tmdbImages = await fetchOfficialTMDBImages(title);
      if (tmdbImages) {
        const selected = isBackdrop ? tmdbImages.backdrop : tmdbImages.poster;
        if (selected) {
          console.log(`[Healer] Successfully corrected image with TMDB Scraper: ${selected}`);
          return selected;
        }
      }
    } catch (tmdbErr) {
      console.warn("[Healer] TMDB image scraper failed, trying secondary fallbacks:", tmdbErr);
    }
    const wikiPoster = await findOfficialWikipediaPoster(title, isBackdrop);
    if (wikiPoster) {
      console.log(`[Healer] Successfully corrected image with Wikipedia Poster: ${wikiPoster}`);
      return wikiPoster;
    }
    if (ai && Date.now() > quotaExceededUntil) {
      try {
        const prompt = `You are an expert movie and television media asset locator.
We need to find the official, high-quality, real, live, public image URL for the ${isBackdrop ? "horizontal backdrop/fanart" : "vertical theatrical poster"} of the movie or series: "${title}".

Search Google to find the official TMDB (The Movie Database), IMDb, or Wikipedia page for this work, and retrieve a direct image URL.

Requirements:
- The URL must be direct, absolute, and end with .jpg, .jpeg, or .png.
- It must load correctly and be a REAL live public link (no 404).
- For a poster (vertical), prefer TMDB paths: e.g., https://image.tmdb.org/t/p/w500/[path_id].jpg
- For a backdrop (horizontal), prefer TMDB paths: e.g., https://image.tmdb.org/t/p/original/[path_id].jpg
- Do NOT return a generic stock photo, search results page, or search engine proxy link. It MUST be a direct static image URL.
- Return ONLY the raw URL as plain text. If you are absolutely unable to find a working link, return "FALLBACK".`;
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }]
          }
        });
        const cleanUrl = response.text?.trim() || "";
        if (cleanUrl && cleanUrl.startsWith("http") && !cleanUrl.includes("FALLBACK")) {
          try {
            const verifyNew = await fetch(cleanUrl, { method: "HEAD", signal: AbortSignal.timeout(1500) });
            if (verifyNew.status === 200) {
              console.log(`[Healer] Corrected image URL with verified TMDB/IMDb link: ${cleanUrl}`);
              return cleanUrl;
            }
          } catch (e) {
            return cleanUrl;
          }
        }
      } catch (aiErr) {
        console.warn("[Healer] Gemini image correction search failed:", aiErr);
        handleGeminiError(aiErr, "verifyAndCorrectImageUrl");
      }
    }
    console.log(`[Healer] Falling back to genre-specific Unsplash image for "${title}"`);
    if (isBackdrop) {
      if (genreStr.includes("\u0623\u0643\u0634\u0646") || genreStr.includes("Action")) return "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";
      if (genreStr.includes("\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A") || genreStr.includes("Sci-Fi")) return "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80";
      if (genreStr.includes("\u0631\u0639\u0628") || genreStr.includes("Horror")) return "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=1200&q=80";
      if (genreStr.includes("\u0643\u0648\u0645\u064A\u062F\u064A\u0627") || genreStr.includes("Comedy")) return "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1200&q=80";
      return defaultBackdrop;
    } else {
      if (genreStr.includes("\u0623\u0643\u0634\u0646") || genreStr.includes("Action")) return "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&q=80";
      if (genreStr.includes("\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A") || genreStr.includes("Sci-Fi")) return "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80";
      if (genreStr.includes("\u0631\u0639\u0628") || genreStr.includes("Horror")) return "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=600&q=80";
      if (genreStr.includes("\u0643\u0648\u0645\u064A\u062F\u064A\u0627") || genreStr.includes("Comedy")) return "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=600&q=80";
      return defaultPoster;
    }
  }
  return url;
}
async function healAndSyncDatabase() {
  console.log("[Server] Running dynamic database healing and sync...");
  let changed = false;
  for (let i = moviesDatabase.length - 1; i >= 0; i--) {
    const m = moviesDatabase[i];
    if (isMovieDeleted(m.id, m.titleAr, m.titleEn)) {
      moviesDatabase.splice(i, 1);
      changed = true;
    }
  }
  let localReferenceMovies = [];
  try {
    localReferenceMovies = loadAllMoviesFromDb();
  } catch (error) {
    console.error("[Server] Error reading SQLite reference for healing:", error);
  }
  for (const refMovie of localReferenceMovies) {
    if (isMovieDeleted(refMovie.id, refMovie.titleAr, refMovie.titleEn)) {
      continue;
    }
    let memoryMovieIndex = moviesDatabase.findIndex((m) => m.id === refMovie.id);
    let memoryMovie = memoryMovieIndex !== -1 ? moviesDatabase[memoryMovieIndex] : null;
    if (!memoryMovie) {
      moviesDatabase.push(refMovie);
      changed = true;
      if (db) {
        await saveMovieToFirestore(refMovie);
      }
      console.log(`[Healer] Restored entirely missing movie: ${refMovie.titleEn} (${refMovie.id})`);
    } else {
      let movieHealed = false;
      const fieldsToRestore = ["poster", "backdrop", "storyAr", "storyEn", "genres", "actors", "duration", "year", "rating", "language", "collectionId", "collectionNameAr", "collectionNameEn", "partNumber"];
      for (const field of fieldsToRestore) {
        if (!memoryMovie[field] || Array.isArray(memoryMovie[field]) && memoryMovie[field].length === 0) {
          memoryMovie[field] = refMovie[field];
          movieHealed = true;
        }
      }
      if (movieHealed) {
        changed = true;
        if (db) {
          await saveMovieToFirestore(memoryMovie);
        }
      }
    }
  }
  await purgeFakeMovies();
  const healPromises = moviesDatabase.map(async (movie) => {
    let movieHealed = false;
    const oldServersLength = movie.servers ? movie.servers.length : 0;
    const oldFirstUrl = movie.servers && movie.servers[0] ? movie.servers[0].url : "";
    enrichMovieMetadata(movie);
    const newServersLength = movie.servers ? movie.servers.length : 0;
    const newFirstUrl = movie.servers && movie.servers[0] ? movie.servers[0].url : "";
    if (oldServersLength !== newServersLength || oldFirstUrl !== newFirstUrl) {
      movieHealed = true;
    }
    const correctSubAr = getValidSubtitleUrl(movie.subtitlesUrlAr, movie.id, "ar", void 0, void 0, movie);
    if (movie.subtitlesUrlAr !== correctSubAr) {
      movie.subtitlesUrlAr = correctSubAr;
      movieHealed = true;
    }
    const correctSubEn = getValidSubtitleUrl(movie.subtitlesUrlEn, movie.id, "en", void 0, void 0, movie);
    if (movie.subtitlesUrlEn !== correctSubEn) {
      movie.subtitlesUrlEn = correctSubEn;
      movieHealed = true;
    }
    const healedSubAr = clearMissingUploadedSubtitle(movie.originalSubtitlesUrlAr);
    if (healedSubAr !== movie.originalSubtitlesUrlAr) {
      console.log(`[Healer] Subtitle file missing on disk for "${movie.titleEn}" (ar): ${movie.originalSubtitlesUrlAr} - clearing so it can be re-searched.`);
      movie.originalSubtitlesUrlAr = healedSubAr;
      movieHealed = true;
    }
    const healedSubEn = clearMissingUploadedSubtitle(movie.originalSubtitlesUrlEn);
    if (healedSubEn !== movie.originalSubtitlesUrlEn) {
      console.log(`[Healer] Subtitle file missing on disk for "${movie.titleEn}" (en): ${movie.originalSubtitlesUrlEn} - clearing so it can be re-searched.`);
      movie.originalSubtitlesUrlEn = healedSubEn;
      movieHealed = true;
    }
    if (movie.type === "series" && movie.seasons) {
      movie.seasons.forEach((season) => {
        if (season.episodes) {
          season.episodes.forEach((episode) => {
            const correctEpSubAr = getValidSubtitleUrl(episode.subtitlesUrlAr, movie.id, "ar", season.id, episode.id, episode);
            if (episode.subtitlesUrlAr !== correctEpSubAr) {
              episode.subtitlesUrlAr = correctEpSubAr;
              movieHealed = true;
            }
            const correctEpSubEn = getValidSubtitleUrl(episode.subtitlesUrlEn, movie.id, "en", season.id, episode.id, episode);
            if (episode.subtitlesUrlEn !== correctEpSubEn) {
              episode.subtitlesUrlEn = correctEpSubEn;
              movieHealed = true;
            }
            const healedEpSubAr = clearMissingUploadedSubtitle(episode.originalSubtitlesUrlAr);
            if (healedEpSubAr !== episode.originalSubtitlesUrlAr) {
              episode.originalSubtitlesUrlAr = healedEpSubAr;
              movieHealed = true;
            }
            const healedEpSubEn = clearMissingUploadedSubtitle(episode.originalSubtitlesUrlEn);
            if (healedEpSubEn !== episode.originalSubtitlesUrlEn) {
              episode.originalSubtitlesUrlEn = healedEpSubEn;
              movieHealed = true;
            }
          });
        }
      });
    }
    const originalPoster = movie.poster;
    const originalBackdrop = movie.backdrop;
    const validatedPoster = await verifyAndCorrectImageUrl(movie.poster, movie.titleEn || movie.titleAr || "Untitled", false, movie.genres);
    if (movie.poster !== validatedPoster) {
      movie.poster = validatedPoster;
      movieHealed = true;
    }
    const validatedBackdrop = await verifyAndCorrectImageUrl(movie.backdrop, movie.titleEn || movie.titleAr || "Untitled", true, movie.genres);
    if (movie.backdrop !== validatedBackdrop) {
      movie.backdrop = validatedBackdrop;
      movieHealed = true;
    }
    if (movie.director) {
      const originalDir = movie.directorPhotoUrl;
      movie.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(movie.director, movie.directorPhotoUrl);
      if (movie.directorPhotoUrl !== originalDir) {
        movieHealed = true;
      }
    }
    if (movie.writer) {
      const originalWriter = movie.writerPhotoUrl;
      movie.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(movie.writer, movie.writerPhotoUrl);
      if (movie.writerPhotoUrl !== originalWriter) {
        movieHealed = true;
      }
    }
    if (movie.castMembers && Array.isArray(movie.castMembers)) {
      for (const cast of movie.castMembers) {
        const originalCast = cast.photoUrl;
        cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
        if (cast.photoUrl !== originalCast) {
          movieHealed = true;
        }
      }
    }
    if (movieHealed) {
      console.log(`[Healer] Healed subtitles/images for: ${movie.titleEn || movie.titleAr} (${movie.id})`);
      if (db) {
        await saveMovieToFirestore(movie);
      }
      changed = true;
    }
  });
  await Promise.all(healPromises);
  const subtitlesBackfilled = await proactivelyFetchMissingSubtitles(moviesDatabase);
  if (subtitlesBackfilled) {
    changed = true;
  }
  const metadataBackfilled = await backfillLanguageAndCountry(moviesDatabase);
  if (metadataBackfilled) {
    changed = true;
  }
  const tmdbCollectionsAssigned = await assignTmdbMovieCollections(moviesDatabase);
  if (tmdbCollectionsAssigned) {
    changed = true;
  }
  const collectionsAssigned = autoAssignMovieCollections(moviesDatabase);
  if (collectionsAssigned) {
    changed = true;
  }
  const deduplicated = await deduplicateDatabase();
  if (deduplicated) {
    changed = true;
  }
  if (changed) {
    saveMoviesDatabase();
  }
}
async function loadDatabaseFromFirestore() {
  if (!db) return false;
  try {
    console.log("[Firestore] Connecting and synchronizing with Cloud Firestore...");
    const configRef = (0, import_firestore.doc)(db, "config", "main_config");
    const configSnap = await (0, import_firestore.getDoc)(configRef);
    if (configSnap.exists()) {
      const config = configSnap.data();
      customHeroId = config.customHeroId || null;
      customTrendingIds = config.customTrendingIds || [];
      customPromos = config.customPromos || [];
      if (config.adsSettings) {
        adsSettings = config.adsSettings;
      }
      if (Array.isArray(config.deletedMovieIds)) {
        config.deletedMovieIds.forEach((id) => deletedMovieIds.add(id));
      }
      if (Array.isArray(config.deletedMovieTitles)) {
        config.deletedMovieTitles.forEach((t) => deletedMovieTitles.add(t.toLowerCase().trim()));
      }
      saveDeletedMovieIds();
      console.log("[Firestore] Successfully loaded custom layout config and deleted list from Cloud Firestore.");
      saveConfig();
    } else {
      console.log("[Firestore] Firestore config is empty. Seeding Firestore with current local layout config...");
      await saveConfigToFirestore();
    }
    const moviesSnapshot = await (0, import_firestore.getDocs)((0, import_firestore.collection)(db, "movies"));
    const firestoreMovies = [];
    moviesSnapshot.forEach((docSnap) => {
      const movie = docSnap.data();
      if (!isMovieDeleted(movie.id, movie.titleAr, movie.titleEn)) {
        firestoreMovies.push(movie);
      }
    });
    if (firestoreMovies.length > 0) {
      const firestoreIds = new Set(firestoreMovies.map((m) => m.id));
      const firestoreTitleArs = new Set(firestoreMovies.map((m) => m.titleAr ? m.titleAr.toLowerCase().trim() : ""));
      const firestoreTitleEns = new Set(firestoreMovies.map((m) => m.titleEn ? m.titleEn.toLowerCase().trim() : ""));
      firestoreMovies.forEach((fsMov) => {
        const localMov = moviesDatabase.find((m) => m.id === fsMov.id);
        if (localMov) {
          if (localMov.subtitlesUrlAr && localMov.subtitlesUrlAr.startsWith("/uploads/")) {
            fsMov.subtitlesUrlAr = localMov.subtitlesUrlAr;
          }
          if (localMov.subtitlesUrlEn && localMov.subtitlesUrlEn.startsWith("/uploads/")) {
            fsMov.subtitlesUrlEn = localMov.subtitlesUrlEn;
          }
          if (localMov.originalSubtitlesUrlAr) fsMov.originalSubtitlesUrlAr = localMov.originalSubtitlesUrlAr;
          if (localMov.originalSubtitlesUrlEn) fsMov.originalSubtitlesUrlEn = localMov.originalSubtitlesUrlEn;
        }
      });
      const missingFromFirestore = moviesDatabase.filter(
        (m) => !isMovieDeleted(m.id, m.titleAr, m.titleEn) && !firestoreIds.has(m.id) && (!m.titleAr || !firestoreTitleArs.has(m.titleAr.toLowerCase().trim())) && (!m.titleEn || !firestoreTitleEns.has(m.titleEn.toLowerCase().trim()))
      );
      moviesDatabase.length = 0;
      moviesDatabase.push(...firestoreMovies, ...missingFromFirestore);
      console.log(`[Firestore] Loaded ${firestoreMovies.length} movies/series from Cloud Firestore, plus ${missingFromFirestore.length} locally uploaded works preserved.`);
      for (const missingMovie of missingFromFirestore) {
        console.log(`[Firestore Sync] Uploading locally saved movie to Cloud Firestore: "${missingMovie.titleAr}" (${missingMovie.id})`);
        await saveMovieToFirestore(missingMovie).catch((err) => console.error(`[Firestore Sync Error]`, err));
      }
      saveMoviesDatabase();
      await healAndSyncDatabase();
    } else {
      console.log("[Firestore] Firestore movies collection is empty. Seeding Firestore with current movies database...");
      await healAndSyncDatabase();
      for (const movie of moviesDatabase) {
        if (!isMovieDeleted(movie.id, movie.titleAr, movie.titleEn)) {
          await saveMovieToFirestore(movie);
        }
      }
    }
    cachedHomeData = null;
    seedRealMoviesFromTMDB().catch((err) => console.error("[Server] Error in background TMDB seeding:", err));
    return true;
  } catch (err) {
    console.error("[Firestore] Failed to connect or sync with Firestore. App is running with robust local fallback database:", err);
    return false;
  }
}
function loadDatabase() {
  loadDeletedMovieIds();
  try {
    const dbMovies = loadAllMoviesFromDb();
    if (dbMovies.length > 0) {
      moviesDatabase.length = 0;
      const filtered = dbMovies.filter((m) => !isMovieDeleted(m.id, m.titleAr, m.titleEn));
      moviesDatabase.push(...filtered);
      console.log(`[Server] Loaded ${moviesDatabase.length} movies from SQLite (filtered ${dbMovies.length - filtered.length} deleted).`);
    } else {
      console.log("[Server] cinemana.db has no movies yet \u2014 run `npm run db:migrate` to import movies_db.json. Persisting in-memory seed data for now.");
      saveMoviesDatabase();
    }
  } catch (error) {
    console.error("[Server] Error loading movies from SQLite:", error);
  }
  try {
    const config = loadConfigFromDb();
    customHeroId = config.customHeroId || null;
    customTrendingIds = config.customTrendingIds || [];
    customPromos = config.customPromos || [];
    if (config.adsSettings) {
      adsSettings = config.adsSettings;
    }
    console.log("[Server] Loaded config from SQLite.");
  } catch (error) {
    console.error("[Server] Error loading config from SQLite:", error);
  }
  setTimeout(() => {
    healAndSyncDatabase().catch((err) => console.error("[Server] Local database healing failed:", err));
  }, 500);
  setTimeout(() => {
    loadDatabaseFromFirestore().catch(console.error);
  }, 1e3);
}
loadDatabase();
var cinemanaImportStats = {
  lastRunTimestamp: null,
  limit: 15,
  processedCount: 0,
  addedCount: 0,
  mergedCount: 0,
  duplicatesSkippedCount: 0,
  lastItemsImported: [],
  isCurrentlyRunning: false,
  nextScheduledRunInMinutes: 60
};
function normalizeTitleForDeduplication(title) {
  if (!title) return "";
  let clean = title.toLowerCase().trim();
  clean = clean.replace(/\b(19|20)\d{2}\b/g, "");
  clean = clean.replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "\u0627").replace(/ة/g, "\u0647").replace(/ى/g, "\u064A").replace(/وو/g, "\u0648");
  clean = clean.replace(/^(فيلم|مسلسل|برنامج|موسم|سلسلة)\s+/gi, "").replace(/^(the|a|an)\s+/gi, "");
  clean = clean.replace(/\bpart\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "part $1").replace(/\bchapter\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "part $1").replace(/\bالجزء\s+(الأول|الاول|1)\b/gi, "part 1").replace(/\bالجزء\s+(الثاني|الثاني|2)\b/gi, "part 2").replace(/\bالجزء\s+(الثالث|الثالث|3)\b/gi, "part 3").replace(/\bالجزء\s+(الرابع|الرابع|4)\b/gi, "part 4").replace(/\bالجزء\s+(الخامس|الخامس|5)\b/gi, "part 5").replace(/\bii\b/gi, "2").replace(/\biii\b/gi, "3").replace(/\biv\b/gi, "4").replace(/\bv\b/gi, "5").replace(/\bvi\b/gi, "6").replace(/\bvii\b/gi, "7").replace(/\bviii\b/gi, "8").replace(/\bix\b/gi, "9").replace(/\bx\b/gi, "10");
  clean = clean.replace(/[^\w\s\u0600-\u06FF]/gi, "").replace(/\s+/g, " ").trim();
  return clean;
}
async function deduplicateDatabase() {
  console.log("[Server] Running smart database deduplication pass...");
  let modified = false;
  const seriesUnified = await unifySeriesAndSeasons();
  if (seriesUnified) modified = true;
  const uniqueMovies = [];
  const removedIds = [];
  for (const movie of moviesDatabase) {
    const normAr = normalizeTitleForDeduplication(movie.titleAr);
    const normEn = normalizeTitleForDeduplication(movie.titleEn);
    const cleanId = movie.id.replace(/\D/g, "");
    const existingIndex = uniqueMovies.findIndex((existing) => {
      if (cleanId && existing.id.replace(/\D/g, "") === cleanId) return true;
      const exNormAr = normalizeTitleForDeduplication(existing.titleAr);
      const exNormEn = normalizeTitleForDeduplication(existing.titleEn);
      const titleMatch = normEn && exNormEn && normEn === exNormEn || normAr && exNormAr && normAr === exNormAr || normEn && exNormAr && normEn === exNormAr || normAr && exNormEn && normAr === exNormEn;
      if (titleMatch) {
        const sameType = existing.type === movie.type;
        const sameYearOrPart = !existing.partNumber && !movie.partNumber || existing.partNumber === movie.partNumber || Math.abs((existing.year || 0) - (movie.year || 0)) <= 1;
        return sameType && sameYearOrPart;
      }
      return false;
    });
    if (existingIndex !== -1) {
      const primary = uniqueMovies[existingIndex];
      if (!primary.poster || primary.poster.includes("unsplash")) primary.poster = movie.poster;
      if (!primary.backdrop || primary.backdrop.includes("unsplash")) primary.backdrop = movie.backdrop;
      if (!primary.storyAr && movie.storyAr) primary.storyAr = movie.storyAr;
      if (!primary.storyEn && movie.storyEn) primary.storyEn = movie.storyEn;
      if ((!primary.servers || primary.servers.length === 0) && movie.servers) primary.servers = movie.servers;
      if (!primary.collectionId && movie.collectionId) {
        primary.collectionId = movie.collectionId;
        primary.collectionNameAr = movie.collectionNameAr;
        primary.collectionNameEn = movie.collectionNameEn;
        primary.partNumber = movie.partNumber;
      }
      removedIds.push(movie.id);
      modified = true;
    } else {
      uniqueMovies.push(movie);
    }
  }
  if (modified) {
    console.log(`[Deduplication] Merged and removed ${removedIds.length} duplicate entries from memory!`);
    moviesDatabase.length = 0;
    moviesDatabase.push(...uniqueMovies);
    if (db) {
      for (const id of removedIds) {
        await deleteMovieFromFirestore(id);
      }
    }
    saveMoviesDatabase();
  }
  return modified;
}
function getCleanTextWithoutYear(titleAr, titleEn) {
  const ar = (titleAr || "").replace(/\b(19|20)\d{2}\b/g, "").toLowerCase();
  const en = (titleEn || "").replace(/\b(19|20)\d{2}\b/g, "").toLowerCase();
  return `${ar} ${en}`;
}
function extractExactPartNumber(titleAr, titleEn, defaultPart = 1) {
  const text = getCleanTextWithoutYear(titleAr, titleEn);
  if (/\b(part\s*10|chapter\s*10|\b10\b|fast\s*x|الجزء\s*العاشر)\b/i.test(text) && !text.includes("box")) return 10;
  if (/\b(part\s*9|chapter\s*9|f9|\b9\b|الجزء\s*التاسع)\b/i.test(text)) return 9;
  if (/\b(part\s*8|chapter\s*8|\b8\b|الجزء\s*الثامن)\b/i.test(text)) return 8;
  if (/\b(part\s*7|chapter\s*7|\b7\b|الجزء\s*السابع)\b/i.test(text)) return 7;
  if (/\b(part\s*6|chapter\s*6|\b6\b|vi|الجزء\s*السادس)\b/i.test(text)) return 6;
  if (/\b(part\s*5|chapter\s*5|\b5\b|v|الجزء\s*الخامس)\b/i.test(text)) return 5;
  if (/\b(part\s*4|chapter\s*4|\b4\b|iv|الجزء\s*الرابع)\b/i.test(text)) return 4;
  if (/\b(part\s*3|chapter\s*3|\b3\b|iii|parabellum|الجزء\s*الثالث)\b/i.test(text)) return 3;
  if (/\b(part\s*2|chapter\s*2|\b2\b|ii|الجزء\s*الثاني)\b/i.test(text)) return 2;
  if (/\b(part\s*1|chapter\s*1|\b1\b|i|الجزء\s*الأول|الجزء\s*الاول)\b/i.test(text)) return 1;
  return defaultPart;
}
async function proactivelyFetchMissingSubtitles(movies) {
  let changed = false;
  const NEGATIVE_CACHE_MS = 24 * 60 * 60 * 1e3;
  const isMissing = (original, failedAt) => {
    if (original) return false;
    if (failedAt && Date.now() - new Date(failedAt).getTime() < NEGATIVE_CACHE_MS) return false;
    return true;
  };
  const candidates = movies.filter(
    (m) => m.type === "movie" && (isMissing(m.originalSubtitlesUrlAr, m.subtitleSearchFailedAtAr) || isMissing(m.originalSubtitlesUrlEn, m.subtitleSearchFailedAtEn))
  ).slice(0, 5);
  for (const movie of candidates) {
    try {
      console.log(`[Subtitles] Proactively searching for missing subtitles: "${movie.titleEn}"`);
      const needsAr = isMissing(movie.originalSubtitlesUrlAr, movie.subtitleSearchFailedAtAr);
      const needsEn = isMissing(movie.originalSubtitlesUrlEn, movie.subtitleSearchFailedAtEn);
      const subs = await findSubtitlesForWork(movie.titleEn, movie.year, movie.type);
      if (needsAr) {
        if (subs.ar) {
          movie.originalSubtitlesUrlAr = subs.ar;
          movie.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&lang=ar`;
          movie.subtitleSearchFailedAtAr = void 0;
        } else {
          movie.subtitleSearchFailedAtAr = (/* @__PURE__ */ new Date()).toISOString();
        }
        changed = true;
      }
      if (needsEn) {
        if (subs.en) {
          movie.originalSubtitlesUrlEn = subs.en;
          movie.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&lang=en`;
          movie.subtitleSearchFailedAtEn = void 0;
        } else {
          movie.subtitleSearchFailedAtEn = (/* @__PURE__ */ new Date()).toISOString();
        }
        changed = true;
      }
    } catch (err) {
      console.warn(`[Subtitles] Proactive search failed for "${movie.titleEn}":`, err.message || err);
    }
  }
  return changed;
}
async function backfillLanguageAndCountry(movies) {
  let changed = false;
  const candidates = movies.filter((m) => !m.metadataCheckedAt && (!m.language || !m.country)).slice(0, 15);
  for (const movie of candidates) {
    const numericId = movie.id.replace(/\D/g, "");
    movie.metadataCheckedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!numericId) {
      changed = true;
      continue;
    }
    try {
      const details = movie.type === "series" ? await getTvDetails(numericId) : await getMovieDetails(numericId);
      if (!details) {
        changed = true;
        continue;
      }
      if (!movie.language) {
        movie.language = details.original_language || "en";
      }
      if (!movie.country) {
        const prodCountries = details.production_countries ?? [];
        if (prodCountries.length > 0) {
          movie.country = TMDB_COUNTRY_MAP[prodCountries[0].iso_3166_1] || prodCountries[0].name;
        }
      }
      changed = true;
    } catch (err) {
      console.warn(`[TMDB] Language/country backfill failed for movie ${movie.id}:`, err.message || err);
    }
  }
  return changed;
}
async function assignTmdbMovieCollections(movies) {
  let changed = false;
  const candidates = movies.filter((m) => m.type === "movie" && !m.collectionId?.startsWith("tmdb_") && !m.collectionCheckedAt).slice(0, 15);
  for (const movie of candidates) {
    const numericId = movie.id.replace(/\D/g, "");
    movie.collectionCheckedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!numericId) {
      changed = true;
      continue;
    }
    try {
      const details = await getMovieDetails(numericId);
      const belongsTo = details?.belongs_to_collection;
      if (belongsTo) {
        const [enCollection, arCollection] = await Promise.all([
          getCollectionDetails(belongsTo.id, "en-US"),
          getCollectionDetails(belongsTo.id, "ar")
        ]);
        const nameEn = enCollection?.name || belongsTo.name;
        const nameAr = arCollection?.name && /[؀-ۿ]/.test(arCollection.name) ? arCollection.name : `\u0633\u0644\u0633\u0644\u0629 ${nameEn}`;
        let partNumber;
        const parts = enCollection?.parts;
        if (parts && parts.length > 0) {
          const sorted = [...parts].sort((a, b) => String(a.release_date || "9999").localeCompare(String(b.release_date || "9999")));
          const idx = sorted.findIndex((p) => String(p.id) === String(numericId));
          if (idx !== -1) partNumber = idx + 1;
        }
        movie.collectionId = `tmdb_${belongsTo.id}`;
        movie.collectionNameEn = nameEn;
        movie.collectionNameAr = nameAr;
        movie.partNumber = partNumber ?? movie.partNumber ?? 1;
        changed = true;
      } else {
        changed = true;
      }
    } catch (err) {
      console.warn(`[TMDB] Collection lookup failed for movie ${movie.id}:`, err.message || err);
    }
  }
  return changed;
}
function autoAssignMovieCollections(movies) {
  let changed = false;
  movies.forEach((m) => {
    if (m.type === "movie" && (m.collectionId?.startsWith("col_") || m.collectionId?.startsWith("auto_"))) {
      m.collectionId = void 0;
      m.collectionNameAr = void 0;
      m.collectionNameEn = void 0;
      m.partNumber = void 0;
      changed = true;
    }
  });
  const franchises = [
    {
      id: "deadpool",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u062F\u064A\u062F\u0628\u0648\u0644",
      nameEn: "Deadpool Collection",
      match: (m) => /\b(deadpool|ديدبول)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/wolverine|ولفرين|\b3\b/i.test(t)) return 3;
        if (/\b2\b|part\s*2|ii/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "john_wick",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u062C\u0648\u0646 \u0648\u064A\u0643",
      nameEn: "John Wick Franchise",
      match: (m) => /\b(john\s*wick|جون\s*ويك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/chapter\s*4|\b4\b|الرابع/i.test(t)) return 4;
        if (/parabellum|chapter\s*3|\b3\b|الثالث/i.test(t)) return 3;
        if (/chapter\s*2|\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "fast_furious",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0633\u0631\u064A\u0639 \u0648\u0627\u0644\u063A\u0627\u0636\u0628 Fast & Furious",
      nameEn: "Fast & Furious Franchise",
      match: (m) => /\b(fast\s*(?:&|and)?\s*furious|fast\s*x|f9|hobbs\s*&(?:and)?\s*shaw|السريع\s*والغاضب|فاست\s*فورس|فاست\s*فيوريوس)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/fast\s*x|\b10\b/i.test(t)) return 10;
        if (/f9|\b9\b/i.test(t)) return 9;
        if (/fate|\b8\b/i.test(t)) return 8;
        if (/\b7\b/i.test(t)) return 7;
        if (/\b6\b/i.test(t)) return 6;
        if (/five|\b5\b/i.test(t)) return 5;
        if (/tokyo|\b3\b/i.test(t)) return 3;
        if (/2\s*fast|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "avatar",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0623\u0641\u0627\u062A\u0627\u0631 Avatar",
      nameEn: "Avatar Collection",
      match: (m) => /\b(avatar|أفاتار|افاتار)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/fire\s*and\s*ash|\b3\b/i.test(t)) return 3;
        if (/way\s*of\s*water|طريق\s*الماء|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "kung_fu_panda",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0643\u0648\u0646\u063A \u0641\u0648 \u0628\u0627\u0646\u062F\u0627",
      nameEn: "Kung Fu Panda Series",
      match: (m) => /\b(kung\s*fu\s*panda|كونغ\s*فو\s*باندا)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "despicable_me",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0623\u0646\u0627 \u0627\u0644\u062D\u0642\u064A\u0631 \u0648\u0627\u0644\u0645\u064A\u0646\u064A\u0648\u0646\u0632",
      nameEn: "Despicable Me & Minions Collection",
      match: (m) => /\b(despicable\s*me|minions|أنا\s*الحقير|انام\s*الحقير|مينيونز)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/despicable\s*me\s*4|\b4\b/i.test(t) && t.includes("despicable")) return 6;
        if (/rise\s*of\s*gru|صعود\s*جرو/i.test(t)) return 5;
        if (/minions|المينيونز/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "avengers",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0646\u062A\u0642\u0645\u0648\u0646 Avengers",
      nameEn: "The Avengers Collection",
      match: (m) => /\b(avengers|المنتقمون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/endgame|نهاية\s*اللعبة/i.test(t)) return 4;
        if (/infinity\s*war|الحرب\s*الانهائية/i.test(t)) return 3;
        if (/ultron|أولترون/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "jurassic",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u062D\u062F\u064A\u0642\u0629 \u0627\u0644\u062C\u0648\u0631\u0627\u0633\u064A\u0629 Jurassic Park",
      nameEn: "Jurassic Park & World Series",
      match: (m) => /\b(jurassic|الحديقة\s*الجوراسية|عالم\s*جوراسي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dominion|الهيمنة/i.test(t)) return 6;
        if (/fallen\s*kingdom|المملكة\s*الساقطة/i.test(t)) return 5;
        if (/world|عالم/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/lost\s*world|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "mission_impossible",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0645\u0647\u0645\u0629 \u0645\u0633\u062A\u062D\u064A\u0644\u0629 Mission: Impossible",
      nameEn: "Mission: Impossible Series",
      match: (m) => /\b(mission\s*:?\s*impossible|مهمة\s*مستحيلة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dead\s*reckoning.*2|part\s*two|الجزء\s*الثاني/i.test(t)) return 8;
        if (/dead\s*reckoning|تقدير\s*الموت|\b7\b/i.test(t)) return 7;
        if (/fallout|تساقط|\b6\b/i.test(t)) return 6;
        if (/rogue\s*nation|أمة\s*مارقة|\b5\b/i.test(t)) return 5;
        if (/ghost\s*protocol|بروتوكول\s*الشبح|\b4\b/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "transformers",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u062A\u062D\u0648\u0644\u0648\u0646 Transformers",
      nameEn: "Transformers Series",
      match: (m) => /\b(transformers|bumblebee|المتحولون|بامبلبي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/beasts|الوحوش/i.test(t)) return 7;
        if (/bumblebee|بامبلبي/i.test(t)) return 6;
        if (/last\s*knight|الفارس\s*الأخير/i.test(t)) return 5;
        if (/extinction|الانقراض/i.test(t)) return 4;
        if (/dark\s*of\s*the\s*moon|القمر/i.test(t)) return 3;
        if (/revenge|الانتقام|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "pirates_caribbean",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0642\u0631\u0627\u0635\u0646\u0629 \u0627\u0644\u0643\u0627\u0631\u064A\u0628\u064A",
      nameEn: "Pirates of the Caribbean Collection",
      match: (m) => /\b(pirates\s*of\s*the\s*caribbean|قراصنة\s*الكاريبي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dead\s*men|الموتى/i.test(t)) return 5;
        if (/stranger\s*tides|غرباء/i.test(t)) return 4;
        if (/world's\s*end|نهاية\s*العالم/i.test(t)) return 3;
        if (/dead\s*man's\s*chest|صندوق/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "lotr",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0633\u064A\u062F \u0627\u0644\u062E\u0648\u0627\u062A\u0645 \u0648\u0627\u0644\u0647\u0648\u0628\u064A\u062A",
      nameEn: "The Lord of the Rings & Hobbit Collection",
      match: (m) => /\b(lord\s*of\s*the\s*rings|hobbit|سيد\s*الخواتم|هوبيت)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/return_of_the_king|عودة\s*الملك/i.test(t)) return 3;
        if (/two\s*towers|البرجين/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "spiderman",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0639\u0627\u0644\u0645 \u0633\u0628\u0627\u064A\u062F\u0631\u0645\u0627\u0646",
      nameEn: "Spider-Man Collection",
      match: (m) => /\b(spider-man|spiderman|سبايدرمان|سبايدر\s*مان)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/across\s*the\s*spider-verse|عبر\s*عالم\s*العنكبوت/i.test(t)) return 5;
        if (/into\s*the\s*spider-verse|داخل\s*عالم\s*العنكبوت/i.test(t)) return 4;
        if (/no\s*way\s*home|لا\s*عودة\s*للمنزل/i.test(t)) return 3;
        if (/far_from_home|بعيدا\s*عن\s*الوطن/i.test(t)) return 2;
        if (/homecoming|العودة\s*للوطن/i.test(t)) return 1;
        return extractExactPartNumber(m.titleAr, m.titleEn);
      }
    },
    {
      id: "batman",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0628\u0627\u062A\u0645\u0627\u0646 \u0648\u0641\u0627\u0631\u0633 \u0627\u0644\u0638\u0644\u0627\u0645",
      nameEn: "Batman & The Dark Knight Franchise",
      match: (m) => /\b(batman|dark\s*knight|باتمان|فارس\s*الظلام)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/rises|نهوض/i.test(t)) return 3;
        if (/dark\s*knight|فارس\s*الظلام/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "harry_potter",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0647\u0627\u0631\u064A \u0628\u0648\u062A\u0631",
      nameEn: "Harry Potter Series",
      match: (m) => /\b(harry\s*potter|fantastic\s*beasts|هاري\s*بوتر|الوحوش\s*المذهلة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/deathly\s*hallows.*2|مقدسات\s*الموت\s*2/i.test(t)) return 8;
        if (/deathly\s*hallows|مقدسات\s*الموت/i.test(t)) return 7;
        if (/half-blood|الأمير\s*الهجين/i.test(t)) return 6;
        if (/order\s*of\s*the\s*phoenix|جماعة\s*العنقاء/i.test(t)) return 5;
        if (/goblet\s*of\s*fire|كأس\s*النار/i.test(t)) return 4;
        if (/prisoner\s*of\s*azkaban|سجين\s*أزكابان/i.test(t)) return 3;
        if (/chamber\s*of\s*secrets|حجرة\s*الأسرار/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "dune",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0643\u062B\u0628\u0627\u0646 Dune",
      nameEn: "Dune Collection",
      match: (m) => /\b(dune|كثبان|ديبون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/part\s*two|\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "shrek",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0634\u0631\u064A\u0643 \u0648 Puss in Boots",
      nameEn: "Shrek & Puss in Boots Universe",
      match: (m) => /\b(shrek|puss\s*in\s*boots|شريك|قط\s*في\s*الأحذية)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "toy_story",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u062D\u0643\u0627\u064A\u0629 \u0644\u0639\u0628\u0629 Toy Story",
      nameEn: "Toy Story Collection",
      match: (m) => /\b(toy\s*story|حكاية\s*لعبة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "httyd",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0643\u064A\u0641 \u062A\u0631\u0648\u0636 \u062A\u0646\u064A\u0646\u0643",
      nameEn: "How to Train Your Dragon Series",
      match: (m) => /\b(how\s*to\s*train\s*your\s*dragon|كيف\s*تروض\s*تنينك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "star_wars",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u062D\u0631\u0628 \u0627\u0644\u0646\u062C\u0648\u0645 Star Wars",
      nameEn: "Star Wars Franchise",
      match: (m) => /\b(star\s*wars|حرب\s*النجوم)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "rocky_creed",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0631\u0648\u0643\u064A \u0648\u0643\u0631\u064A\u062F Creed & Rocky",
      nameEn: "Rocky & Creed Franchise",
      match: (m) => /\b(creed|rocky|كريد|روكي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "sonic",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0642\u0646\u0641\u0630 \u0633\u0648\u0646\u064A\u0643 Sonic",
      nameEn: "Sonic the Hedgehog Collection",
      match: (m) => /\b(sonic|سونيك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "top_gun",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u062A\u0648\u0628 \u063A\u0627\u0646 Top Gun",
      nameEn: "Top Gun Series",
      match: (m) => /\b(top\s*gun|توب\s*غان)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/maverick|مافريك|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "hotel_transylvania",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0641\u0646\u062F\u0642 \u062A\u0631\u0627\u0646\u0633\u064A\u0644\u0641\u0627\u0646\u064A\u0627",
      nameEn: "Hotel Transylvania Collection",
      match: (m) => /\b(hotel\s*transylvania|فندق\s*ترانسيلفانيا)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "ice_age",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0639\u0635\u0631 \u0627\u0644\u062C\u0644\u064A\u062F\u064A Ice Age",
      nameEn: "Ice Age Series",
      match: (m) => /\b(ice\s*age|العصر\s*الجليدي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "madagascar",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0645\u062F\u063A\u0634\u0642\u0631 Madagascar",
      nameEn: "Madagascar Collection",
      match: (m) => /\b(madagascar|مدغشقر)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "gladiator",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0635\u0627\u0631\u0639 Gladiator",
      nameEn: "Gladiator Collection",
      match: (m) => /\b(gladiator|المصارع)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/\b2\b|ii|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "inside_out",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0642\u0644\u0628\u0627\u064B \u0648\u0642\u0627\u0644\u0628\u0627\u064B Inside Out",
      nameEn: "Inside Out Series",
      match: (m) => /\b(inside\s*out|قلبا\s*وقالبا|قلباً\s*وقالباً)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "venom",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0641\u064A\u0646\u0648\u0645 Venom",
      nameEn: "Venom Collection",
      match: (m) => /\b(venom|فينوم)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/last\s*dance|الرقصة\s*الأخيرة|\b3\b/i.test(t)) return 3;
        if (/carnage|مجزرة|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "bad_boys",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0641\u062A\u064A\u0627\u0646 \u0627\u0644\u0623\u0634\u0642\u064A\u0627\u0621 Bad Boys",
      nameEn: "Bad Boys Series",
      match: (m) => /\b(bad\s*boys|فتيان\s*أشقياء|فتيان\s*اشقياء)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/ride\s*or\s*die|\b4\b/i.test(t)) return 4;
        if (/for\s*life|\b3\b/i.test(t)) return 3;
        if (/\b2\b|ii/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "matrix",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0645\u0627\u062A\u0631\u064A\u0643\u0633 The Matrix",
      nameEn: "The Matrix Collection",
      match: (m) => /\b(matrix|الماتريكس|ماتريكس)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/resurrections|\b4\b/i.test(t)) return 4;
        if (/revolutions|\b3\b/i.test(t)) return 3;
        if (/reloaded|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "hunger_games",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0623\u0644\u0639\u0627\u0628 \u0627\u0644\u062C\u0648\u0639 The Hunger Games",
      nameEn: "The Hunger Games Series",
      match: (m) => /\b(hunger\s*games|ألعاب\s*الجوع|العاب\s*الجوع)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/songbirds|snakes/i.test(t)) return 5;
        if (/mockingjay.*2|\b4\b/i.test(t)) return 4;
        if (/mockingjay|\b3\b/i.test(t)) return 3;
        if (/catching\s*fire|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "maze_runner",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0639\u062F\u0627\u0621 \u0627\u0644\u0645\u062A\u0627\u0647\u0629 The Maze Runner",
      nameEn: "The Maze Runner Series",
      match: (m) => /\b(maze\s*runner|عداء\s*المتاهة|متسابق\s*المتاهة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/death\s*cure|\b3\b/i.test(t)) return 3;
        if (/scorch\s*trials|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "twilight",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0634\u0641\u0642 Twilight",
      nameEn: "The Twilight Saga",
      match: (m) => /\b(twilight|توايلايت|الشفق)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "sing",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0633\u064A\u0646\u062C Sing",
      nameEn: "Sing Collection",
      match: (m) => /\b(sing|سينج)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "secret_life_pets",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u062D\u064A\u0627\u0629 \u0627\u0644\u0633\u0631\u064A\u0629 \u0644\u0644\u062D\u064A\u0648\u0627\u0646\u0627\u062A \u0627\u0644\u0623\u0644\u064A\u0641\u0629",
      nameEn: "The Secret Life of Pets Collection",
      match: (m) => /\b(secret\s*life\s*of\s*pets|الحياة\s*السرية\s*للحيوانات\s*الأليفة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "monsters_inc",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0634\u0631\u0643\u0629 \u0627\u0644\u0645\u0631\u0639\u0628\u064A\u0646 \u0627\u0644\u0645\u062D\u062F\u0648\u062F\u0629",
      nameEn: "Monsters, Inc. Universe",
      match: (m) => /\b(monsters,?\s*inc|monsters\s*university|شركة\s*المرعبين|جامعة\s*المرعبين)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "finding_nemo",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0646\u064A\u0645\u0648 \u0648\u062F\u0648\u0631\u064A",
      nameEn: "Finding Nemo Collection",
      match: (m) => /\b(finding\s*nemo|finding\s*dory|البحث\s*عن\s*نيمو|البحث\s*عن\s*دوري)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dory|دوري/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "incredibles",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0623\u0628\u0637\u0627\u0644 \u062E\u0627\u0631\u0642\u0648\u0646 The Incredibles",
      nameEn: "The Incredibles Collection",
      match: (m) => /\b(incredibles|المذهلون|أبطال\s*خارقون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "cars",
      nameAr: "\u0633\u0644\u0633\u0644\u0629 \u0633\u064A\u0627\u0631\u0627\u062A Cars",
      nameEn: "Cars Series",
      match: (m) => /\b(cars|سيارات)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    }
  ];
  movies.forEach((movie) => {
    if (movie.collectionId?.startsWith("tmdb_")) return;
    for (const f of franchises) {
      if (f.match(movie)) {
        const targetPart = f.getPart(movie);
        if (movie.collectionId !== f.id || String(movie.partNumber) !== String(targetPart)) {
          movie.collectionId = f.id;
          movie.collectionNameAr = f.nameAr;
          movie.collectionNameEn = f.nameEn;
          movie.partNumber = targetPart;
          changed = true;
        }
        break;
      }
    }
  });
  const BANNED_PREFIXES = /* @__PURE__ */ new Set([
    "the",
    "a",
    "an",
    "man",
    "dark",
    "love",
    "blood",
    "king",
    "war",
    "star",
    "last",
    "first",
    "\u0627\u0644\u0645\u0648\u062A",
    "\u0627\u0644\u062D\u0628",
    "\u0627\u0644\u0631\u062C\u0644",
    "\u0627\u0644\u0644\u064A\u0644",
    "\u0627\u0644\u0645\u0644\u0643",
    "\u0627\u0644\u062D\u0631\u0628",
    "\u0627\u0644\u0646\u062C\u0645",
    "\u0627\u0644\u0639\u0627\u0644\u0645",
    "\u0627\u0644\u0623\u062E\u064A\u0631",
    "\u0627\u0644\u0627\u0648\u0644"
  ]);
  const unassignedMovies = movies.filter((m) => m.type === "movie" && !m.collectionId);
  const prefixGroups = {};
  unassignedMovies.forEach((movie) => {
    let cleanEn = movie.titleEn ? movie.titleEn.toLowerCase().replace(/[:\-\(\)].*$/, "").replace(/\b(the|a|an)\b/gi, "").replace(/\b(part|chapter|volume|part\s*2|part\s*3|2|3|4|ii|iii|iv)\b/gi, "").trim() : "";
    let cleanAr = movie.titleAr ? movie.titleAr.replace(/[:\-\(\)].*$/, "").replace(/^(فيلم|مسلسل)\s+/, "").replace(/\b(الجزء|جزء|الثاني|الثالث|الرابع|الأول|1|2|3|4)\b/g, "").trim() : "";
    const key = cleanEn.length >= 5 && !BANNED_PREFIXES.has(cleanEn) ? cleanEn : cleanAr.length >= 5 && !BANNED_PREFIXES.has(cleanAr) ? cleanAr : "";
    if (key) {
      if (!prefixGroups[key]) prefixGroups[key] = [];
      prefixGroups[key].push(movie);
    }
  });
  Object.keys(prefixGroups).forEach((key) => {
    const group = prefixGroups[key];
    const hasExplicitPartIndicator = group.some((m) => {
      const text = getCleanTextWithoutYear(m.titleAr, m.titleEn);
      return /\b(part\s*\d+|chapter\s*\d+|\b2\b|\b3\b|\b4\b|ii|iii|iv|الجزء\s*(الثاني|الثالث|الرابع))\b/i.test(text);
    });
    if (group.length >= 2 && hasExplicitPartIndicator) {
      group.sort((a, b) => (a.year || 0) - (b.year || 0));
      const firstMovie = group[0];
      const colId = `col_${key.replace(/\s+/g, "_").replace(/[^\w]/g, "")}`;
      const nameAr = `\u0633\u0644\u0633\u0644\u0629 ${firstMovie.titleAr.replace(/[:\-\(].*$/, "").trim()}`;
      const nameEn = `${firstMovie.titleEn.replace(/[:\-\(].*$/, "").trim()} Collection`;
      group.forEach((movie, index) => {
        let detectedPart = extractExactPartNumber(movie.titleAr, movie.titleEn, index + 1);
        if (movie.collectionId !== colId) {
          movie.collectionId = colId;
          movie.collectionNameAr = nameAr;
          movie.collectionNameEn = nameEn;
          movie.partNumber = detectedPart;
          changed = true;
        }
      });
    }
  });
  return changed;
}
function getSeriesRootTitle(titleAr, titleEn) {
  let ar = (titleAr || "").trim();
  let en = (titleEn || "").trim();
  const seasonPatternAr = /\s*[-:_–—]?\s*(الموسم|الجزء)\s*([\u0600-\u06FF0-9a-zA-Z]+)?/gi;
  const seasonPatternEn = /\s*[-:_–—]?\s*(Season|S|Part)\s*(\d+|[I|V|X]+)?/gi;
  ar = ar.replace(seasonPatternAr, "").replace(/[-:_–—]\s*$/, "").trim();
  en = en.replace(seasonPatternEn, "").replace(/[-:_–—]\s*$/, "").trim();
  return {
    rootAr: ar || titleAr || "",
    rootEn: en || titleEn || ""
  };
}
function extractSeasonNumberFromTitle(titleAr, titleEn) {
  const text = `${titleAr || ""} ${titleEn || ""}`;
  const enMatch = text.match(/(?:Season|S|Part)\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10);
  const arMatch = text.match(/(?:الموسم|الجزء)\s*([\u0600-\u06FF0-9]+)/i);
  if (arMatch) {
    const val = arMatch[1].trim();
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    if (val.includes("\u0627\u0644\u0623\u0648\u0644") || val.includes("\u0627\u0644\u0627\u0648\u0644")) return 1;
    if (val.includes("\u0627\u0644\u062B\u0627\u0646\u064A")) return 2;
    if (val.includes("\u0627\u0644\u062B\u0627\u0644\u062B")) return 3;
    if (val.includes("\u0627\u0644\u0631\u0627\u0628\u0639")) return 4;
    if (val.includes("\u0627\u0644\u062E\u0627\u0645\u0633")) return 5;
    if (val.includes("\u0627\u0644\u0633\u0627\u062F\u0633")) return 6;
    if (val.includes("\u0627\u0644\u0633\u0627\u0628\u0639")) return 7;
    if (val.includes("\u0627\u0644\u062B\u0627\u0645\u0646")) return 8;
    if (val.includes("\u0627\u0644\u062A\u0627\u0633\u0639")) return 9;
    if (val.includes("\u0627\u0644\u0639\u0627\u0634\u0631")) return 10;
  }
  return 1;
}
async function unifySeriesAndSeasons() {
  console.log("[Series Unifier] Unifying series and merging separate seasons...");
  let modified = false;
  const unifiedList = [];
  const removedIds = [];
  for (const item of moviesDatabase) {
    if (item.type !== "series") {
      unifiedList.push(item);
      continue;
    }
    const { rootAr, rootEn } = getSeriesRootTitle(item.titleAr, item.titleEn);
    const normRootAr = normalizeTitleForDeduplication(rootAr);
    const normRootEn = normalizeTitleForDeduplication(rootEn);
    const cleanNumericId = item.id.replace(/\D/g, "");
    const existingIndex = unifiedList.findIndex((existing) => {
      if (existing.type !== "series") return false;
      const exCleanId = existing.id.replace(/\D/g, "");
      if (cleanNumericId && exCleanId && cleanNumericId === exCleanId) return true;
      const exRoots = getSeriesRootTitle(existing.titleAr, existing.titleEn);
      const exNormAr = normalizeTitleForDeduplication(exRoots.rootAr);
      const exNormEn = normalizeTitleForDeduplication(exRoots.rootEn);
      if (normRootEn && exNormEn && normRootEn === exNormEn) return true;
      if (normRootAr && exNormAr && normRootAr === exNormAr) return true;
      if (normRootEn && exNormAr && normRootEn === exNormAr) return true;
      if (normRootAr && exNormEn && normRootAr === exNormEn) return true;
      return false;
    });
    if (existingIndex !== -1) {
      const primary = unifiedList[existingIndex];
      if (!primary.seasons) primary.seasons = [];
      const detectedNum = extractSeasonNumberFromTitle(item.titleAr, item.titleEn);
      const incomingSeasons = item.seasons && item.seasons.length > 0 ? item.seasons : [{
        id: `s${detectedNum}_${item.id}`,
        number: detectedNum,
        titleAr: `\u0627\u0644\u0645\u0648\u0633\u0645 ${detectedNum}`,
        titleEn: `Season ${detectedNum}`,
        poster: item.poster,
        backdrop: item.backdrop,
        year: item.year,
        storyAr: item.storyAr,
        storyEn: item.storyEn,
        episodes: (item.servers || []).map((srv, idx) => ({
          id: `ep_${idx + 1}_${item.id}`,
          number: idx + 1,
          titleAr: srv.name || `\u0627\u0644\u062D\u0644\u0642\u0629 ${idx + 1}`,
          titleEn: srv.name || `Episode ${idx + 1}`,
          duration: "45m",
          storyAr: item.storyAr,
          storyEn: item.storyEn,
          thumbnail: item.backdrop || item.poster,
          servers: [srv],
          subtitlesUrlAr: item.subtitlesUrlAr || "",
          subtitlesUrlEn: item.subtitlesUrlEn || "",
          rating: item.rating || 8
        }))
      }];
      for (const incSzn of incomingSeasons) {
        const sznNum = incSzn.number || detectedNum;
        const exSzn = primary.seasons.find((s) => s.number === sznNum);
        if (exSzn) {
          if (!exSzn.poster || exSzn.poster.includes("unsplash")) exSzn.poster = incSzn.poster || item.poster || primary.poster;
          if (!exSzn.storyAr) exSzn.storyAr = incSzn.storyAr || item.storyAr;
          if (!exSzn.storyEn) exSzn.storyEn = incSzn.storyEn || item.storyEn;
          if (incSzn.episodes && incSzn.episodes.length > 0) {
            for (const ep of incSzn.episodes) {
              if (!exSzn.episodes.some((e) => e.number === ep.number || e.id === ep.id)) {
                exSzn.episodes.push(ep);
              }
            }
            exSzn.episodes.sort((a, b) => a.number - b.number);
          }
        } else {
          if (!incSzn.poster || incSzn.poster.includes("unsplash")) {
            incSzn.poster = item.poster || primary.poster;
          }
          primary.seasons.push({
            ...incSzn,
            number: sznNum,
            titleAr: incSzn.titleAr || `\u0627\u0644\u0645\u0648\u0633\u0645 ${sznNum}`,
            titleEn: incSzn.titleEn || `Season ${sznNum}`
          });
        }
      }
      primary.seasons.sort((a, b) => a.number - b.number);
      removedIds.push(item.id);
      modified = true;
    } else {
      const cleanRoots = getSeriesRootTitle(item.titleAr, item.titleEn);
      item.titleAr = cleanRoots.rootAr;
      item.titleEn = cleanRoots.rootEn;
      if (item.seasons && item.seasons.length > 0) {
        item.seasons.sort((a, b) => a.number - b.number);
      }
      unifiedList.push(item);
    }
  }
  if (modified) {
    console.log(`[Series Unifier] Merged ${removedIds.length} separate season entries into unified series!`);
    moviesDatabase.length = 0;
    moviesDatabase.push(...unifiedList);
    if (db) {
      for (const id of removedIds) {
        await deleteMovieFromFirestore(id);
      }
    }
    saveMoviesDatabase();
  }
  return modified;
}
function findDuplicateMovieOrSeries(titleAr, titleEn, rawId, type) {
  const normAr = normalizeTitleForDeduplication(titleAr);
  const normEn = normalizeTitleForDeduplication(titleEn);
  const cleanId = rawId ? rawId.replace(/\D/g, "") : "";
  const rootObj = getSeriesRootTitle(titleAr, titleEn);
  const rootNormAr = normalizeTitleForDeduplication(rootObj.rootAr);
  const rootNormEn = normalizeTitleForDeduplication(rootObj.rootEn);
  for (const movie of moviesDatabase) {
    if (type && movie.type !== type) continue;
    if (cleanId) {
      const existingCleanId = movie.id.replace(/\D/g, "");
      if (existingCleanId && existingCleanId === cleanId) {
        return movie;
      }
    }
    const existingNormAr = normalizeTitleForDeduplication(movie.titleAr);
    const existingNormEn = normalizeTitleForDeduplication(movie.titleEn);
    if (normEn && existingNormEn && normEn === existingNormEn) return movie;
    if (normAr && existingNormAr && normAr === existingNormAr) return movie;
    if (normEn && existingNormAr && normEn === existingNormAr) return movie;
    if (normAr && existingNormEn && normAr === existingNormEn) return movie;
    if (movie.type === "series") {
      const exRoots = getSeriesRootTitle(movie.titleAr, movie.titleEn);
      const exRootNormAr = normalizeTitleForDeduplication(exRoots.rootAr);
      const exRootNormEn = normalizeTitleForDeduplication(exRoots.rootEn);
      if (rootNormEn && exRootNormEn && rootNormEn === exRootNormEn) return movie;
      if (rootNormAr && exRootNormAr && rootNormAr === exRootNormAr) return movie;
      if (rootNormEn && exRootNormAr && rootNormEn === exRootNormAr) return movie;
      if (rootNormAr && exRootNormEn && rootNormAr === exRootNormEn) return movie;
    }
  }
  return null;
}
async function purgeFakeMovies() {
  const validMovies = [];
  const fakeIds = [];
  for (const m of moviesDatabase) {
    const isFakeTitle = (m.titleAr || "").includes("\u0641\u064A\u0644\u0645 \u0627\u0644\u062E\u064A\u0627\u0644 \u0648\u0627\u0644\u0623\u0643\u0634\u0646") || (m.titleEn || "").includes("\u0641\u064A\u0644\u0645 \u0627\u0644\u062E\u064A\u0627\u0644 \u0648\u0627\u0644\u0623\u0643\u0634\u0646") || (m.titleAr || "").includes("\u0641\u064A\u0644\u0645 \u0623\u0648 \u0645\u0633\u0644\u0633\u0644 \u062D\u0642\u064A\u0642\u064A");
    const hasCustomServer = m.servers && m.servers.length > 0 && !isPlaceholderServer(m.servers);
    if (isFakeTitle && !hasCustomServer) {
      fakeIds.push(m.id);
      console.log(`[Purge] Removing fake placeholder movie entry: "${m.titleAr}" (${m.id})`);
    } else {
      validMovies.push(m);
    }
  }
  if (fakeIds.length > 0) {
    moviesDatabase.length = 0;
    moviesDatabase.push(...validMovies);
    saveMoviesDatabase();
    console.log(`[Purge] Purged ${fakeIds.length} fake/mock movie entries. Database size now: ${moviesDatabase.length}`);
    if (db) {
      for (const fakeId of fakeIds) {
        try {
          const docRef = (0, import_firestore.doc)(db, "movies", fakeId);
          await (0, import_firestore.deleteDoc)(docRef);
          console.log(`[Firestore Purge] Deleted fake document ${fakeId} from Firestore.`);
        } catch (err) {
          console.error(`[Firestore Purge Error] Failed to delete ${fakeId}:`, err.message || err);
        }
      }
    }
    cachedHomeData = null;
  }
}
async function importBatchFromCinemanaAndTMDB(options) {
  const limit = options.limit || 15;
  if (cinemanaImportStats.isCurrentlyRunning) {
    console.log("[Cinemana Importer] An import batch is already in progress. Skipping concurrent run.");
    return { status: "running", message: "\u062C\u0627\u0631\u064A \u0627\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u062D\u0627\u0644\u064A\u0627\u064B \u0628\u0627\u0644\u0641\u0639\u0644", stats: cinemanaImportStats };
  }
  cinemanaImportStats.isCurrentlyRunning = true;
  console.log(`[Cinemana Importer] Starting batch import (Target: ${limit} items per run)...`);
  let processed = 0;
  let added = 0;
  let merged = 0;
  let skipped = 0;
  const importedTitles = [];
  try {
    await purgeFakeMovies();
    let candidates = [];
    if (options.forceQuery) {
      candidates.push(options.forceQuery);
    }
    const realTMDBPaths = await getTrendingPaths().catch(() => []);
    candidates.push(...realTMDBPaths);
    const liveDiscovered = await fetchFutureAndTrendingTitlesFromGemini().catch(() => []);
    candidates.push(...liveDiscovered);
    const defaultTrending = [
      "Deadpool & Wolverine",
      "Inside Out 2",
      "Dune: Part Two",
      "Oppenheimer",
      "Gladiator II",
      "Alien: Romulus",
      "Moana 2",
      "Wicked",
      "Kingdom of the Planet of the Apes",
      "The Batman",
      "House of the Dragon",
      "The Last of Us",
      "Squid Game",
      "The Boys",
      "Shogun",
      "Fallout",
      "Stranger Things",
      "Breaking Bad",
      "Game of Thrones",
      "Succession",
      "Severance",
      "The Mandalorian",
      "Wednesday",
      "Bad Boys: Ride or Die",
      "Twisters",
      "Interstellar",
      "Inception",
      "The Dark Knight",
      "Avengers: Endgame",
      "Avatar: The Way of Water",
      "Barbie",
      "Civil War",
      "Furiosa: A Mad Max Saga",
      "Godzilla x Kong: The New Empire",
      "Kung Fu Panda 4",
      "Spider-Man: Across the Spider-Verse",
      "Guardians of the Galaxy Vol. 3",
      "John Wick: Chapter 4",
      "Mission: Impossible - Dead Reckoning",
      "Top Gun: Maverick",
      "Spider-Man: No Way Home",
      "Doctor Strange in the Multiverse of Madness",
      "Thor: Love and Thunder",
      "Black Panther: Wakanda Forever",
      "Joker",
      "Avengers: Infinity War",
      "Captain America: Civil War",
      "Iron Man",
      "The Avengers",
      "Fast X",
      "F9: The Fast Saga",
      "Hobbs & Shaw",
      "The Fate of the Furious",
      "Furious 7",
      "Jurassic World Dominion",
      "Jurassic World: Fallen Kingdom",
      "Jurassic World",
      "Jurassic Park",
      "The Lost World: Jurassic Park",
      "Transformers: Rise of the Beasts",
      "Transformers: The Last Knight",
      "Bumblebee",
      "Transformers: Age of Extinction",
      "Creed III",
      "Creed II",
      "Creed",
      "Rocky",
      "Rocky IV",
      "Mission: Impossible - Fallout",
      "Mission: Impossible - Rogue Nation",
      "Mission: Impossible - Ghost Protocol",
      "Top Gun",
      "John Wick",
      "John Wick: Chapter 2",
      "John Wick: Chapter 3 - Parabellum",
      "The Matrix",
      "The Matrix Resurrections",
      "Pirates of the Caribbean: The Curse of the Black Pearl",
      "Pirates of the Caribbean: Dead Man's Chest",
      "Pirates of the Caribbean: At World's End",
      "Harry Potter and the Sorcerer's Stone",
      "Harry Potter and the Chamber of Secrets",
      "Harry Potter and the Prisoner of Azkaban",
      "Harry Potter and the Goblet of Fire",
      "The Lord of the Rings: The Fellowship of the Ring",
      "The Lord of the Rings: The Two Towers",
      "The Lord of the Rings: The Return of the King",
      "Star Wars: Episode IV - A New Hope",
      "Star Wars: Episode V - The Empire Strikes Back",
      "Star Wars: Episode VI - Return of the Jedi",
      "Despicable Me 4",
      "Despicable Me 3",
      "Despicable Me 2",
      "Minions",
      "Toy Story",
      "Toy Story 2",
      "Toy Story 3",
      "Toy Story 4",
      "Monsters, Inc.",
      "Finding Nemo",
      "The Incredibles",
      "Incredibles 2",
      "Cars",
      "Ratatouille",
      "Wall-E",
      "Up",
      "Coco",
      "Soul",
      "Luca",
      "Elemental",
      "Inside Out",
      "Shrek",
      "Shrek 2",
      "Puss in Boots: The Last Wish",
      "How to Train Your Dragon",
      "Kung Fu Panda",
      "Kung Fu Panda 2",
      "Kung Fu Panda 3",
      "Ice Age",
      "Hotel Transylvania",
      "Spider-Man: Into the Spider-Verse",
      "The Super Mario Bros. Movie",
      "Sonic the Hedgehog",
      "Sonic the Hedgehog 2",
      "Free Guy"
    ];
    candidates.push(...defaultTrending);
    candidates = Array.from(new Set(candidates));
    let candidateIndex = 0;
    while (added < limit && candidateIndex < candidates.length) {
      const titleCandidate = candidates[candidateIndex];
      candidateIndex++;
      if (!titleCandidate) continue;
      processed++;
      const existingDuplicate = findDuplicateMovieOrSeries(titleCandidate, titleCandidate);
      if (existingDuplicate) {
        console.log(`[Cinemana Importer] [Deduplication Filter] Duplicate skipped: "${titleCandidate}" (Matches existing ID: ${existingDuplicate.id} / ${existingDuplicate.titleAr})`);
        skipped++;
        continue;
      }
      console.log(`[Cinemana Importer] Importing & Syncing item ${added + 1}/${limit}: "${titleCandidate}"...`);
      let movieData = null;
      try {
        movieData = await scrapeTMDBMetadata(titleCandidate).catch(() => null);
        if (!movieData || !movieData.titleEn && !movieData.titleAr) {
          if (ai && Date.now() > quotaExceededUntil) {
            movieData = await generateMovieWithGemini(titleCandidate).catch(() => null);
          }
        }
      } catch (itemErr) {
        console.warn(`[Cinemana Importer] Item processing failed for "${titleCandidate}":`, itemErr.message || itemErr);
      }
      if (!movieData || !movieData.titleEn && !movieData.titleAr) {
        console.warn(`[Cinemana Importer] Skipping candidate as no real TMDB movie/series metadata was found for: "${titleCandidate}"`);
        skipped++;
        continue;
      }
      const secondCheckDuplicate = findDuplicateMovieOrSeries(movieData.titleAr, movieData.titleEn, movieData.id);
      if (secondCheckDuplicate) {
        console.log(`[Cinemana Importer] [Deduplication Filter] Duplicate skipped on second pass: "${movieData.titleEn}"`);
        if (movieData.type === "series" && movieData.seasons && secondCheckDuplicate.type === "series") {
          let mergedSeasons = false;
          if (!secondCheckDuplicate.seasons) secondCheckDuplicate.seasons = [];
          for (const newSeason of movieData.seasons) {
            const existingSeason = secondCheckDuplicate.seasons.find((s) => s.number === newSeason.number || s.id === newSeason.id);
            if (!existingSeason) {
              secondCheckDuplicate.seasons.push(newSeason);
              mergedSeasons = true;
            } else if (newSeason.episodes && newSeason.episodes.length > (existingSeason.episodes?.length || 0)) {
              existingSeason.episodes = newSeason.episodes;
              mergedSeasons = true;
            }
          }
          if (mergedSeasons) {
            merged++;
            console.log(`[Cinemana Importer] Merged updated seasons into existing series: "${secondCheckDuplicate.titleAr}"`);
            await saveMovieToFirestore(secondCheckDuplicate);
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
        continue;
      }
      const cleanNumericId = movieData.id.replace(/\D/g, "") || String(Date.now());
      if (movieData.type === "movie") {
        movieData.servers = getRealStreamingServers({ id: cleanNumericId, type: "movie", titleEn: movieData.titleEn });
        movieData.subtitlesUrlAr = getValidSubtitleUrl(movieData.subtitlesUrlAr, movieData.id, "ar", void 0, void 0, movieData);
        movieData.subtitlesUrlEn = getValidSubtitleUrl(movieData.subtitlesUrlEn, movieData.id, "en", void 0, void 0, movieData);
      } else if (movieData.type === "series") {
        if (!movieData.seasons || movieData.seasons.length === 0) {
          const scrapedSeasons = await fetchTMDBSeriesSeasons(movieData.id.replace(/\D/g, ""), movieData.titleEn, movieData.titleAr, movieData.backdrop, movieData.rating);
          if (scrapedSeasons && scrapedSeasons.length > 0) {
            movieData.seasons = scrapedSeasons;
          } else {
            const sId = "s1";
            movieData.seasons = [
              {
                id: sId,
                number: 1,
                titleAr: "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0623\u0648\u0644",
                titleEn: "Season 1",
                episodes: Array.from({ length: 10 }).map((_, i) => {
                  const epNum = i + 1;
                  const epId = `s1_e${epNum}_${movieData.id}`;
                  return {
                    id: epId,
                    number: epNum,
                    titleAr: `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum}`,
                    titleEn: `Episode ${epNum}`,
                    duration: "45m",
                    storyAr: `\u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u062D\u0644\u0642\u0629 ${epNum} \u0645\u0646 \u0645\u0633\u0644\u0633\u0644 ${movieData.titleAr}.`,
                    storyEn: `Details and plot of Episode ${epNum} of Season 1 of ${movieData.titleEn}.`,
                    thumbnail: movieData.backdrop,
                    servers: getRealStreamingServers({ id: cleanNumericId, type: "series", titleEn: movieData.titleEn }, 1, epNum),
                    subtitlesUrlAr: `/api/subtitles?movieId=${movieData.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
                    subtitlesUrlEn: `/api/subtitles?movieId=${movieData.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
                    rating: movieData.rating
                  };
                })
              }
            ];
          }
        }
      }
      movieData.isPublished = true;
      moviesDatabase.push(movieData);
      added++;
      importedTitles.push(`${movieData.titleAr} (${movieData.titleEn})`);
      await saveMovieToFirestore(movieData).catch((err) => console.error(`[Cinemana Importer] Error saving ${movieData.id} to Firestore:`, err));
      await new Promise((r) => setTimeout(r, 200));
    }
    if (added > 0 || merged > 0) {
      saveMoviesDatabase();
      cachedHomeData = null;
      console.log(`[Cinemana Importer] Batch successful! Added: ${added}, Merged: ${merged}, Skipped duplicates: ${skipped}. Persisted to Cloud Firestore.`);
    } else {
      console.log(`[Cinemana Importer] Batch finished. No new non-duplicate items were found in this run.`);
    }
    cinemanaImportStats.lastRunTimestamp = Date.now();
    cinemanaImportStats.processedCount += processed;
    cinemanaImportStats.addedCount += added;
    cinemanaImportStats.mergedCount += merged;
    cinemanaImportStats.duplicatesSkippedCount += skipped;
    if (importedTitles.length > 0) {
      cinemanaImportStats.lastItemsImported = importedTitles;
    }
    return {
      status: "success",
      message: `\u062A\u0645 \u0627\u0633\u062A\u064A\u0631\u0627\u062F ${added} \u0641\u064A\u0644\u0645/\u0645\u0633\u0644\u0633\u0644 \u062C\u062F\u064A\u062F \u0648\u062A\u062D\u062F\u064A\u062B ${merged} \u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0648\u062A\u062E\u0637\u064A ${skipped} \u0645\u0643\u0631\u0631\u0627\u062A \u0648\u062D\u0641\u0638\u0647\u0627 \u0633\u062D\u0627\u0628\u064A\u0627\u064B \u0641\u064A Firestore \u0628\u0646\u062C\u0627\u062D`,
      stats: {
        limit,
        processedInRun: processed,
        addedInRun: added,
        mergedInRun: merged,
        duplicatesSkippedInRun: skipped,
        savedToFirestore: true,
        lastItemsImported: importedTitles,
        totalInDatabase: moviesDatabase.length
      }
    };
  } catch (err) {
    console.error("[Cinemana Importer] Error during import batch:", err);
    return {
      status: "error",
      message: err.message || "\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0627\u0633\u062A\u064A\u0631\u0627\u062F",
      stats: cinemanaImportStats
    };
  } finally {
    cinemanaImportStats.isCurrentlyRunning = false;
  }
}
var subtitlesCache = /* @__PURE__ */ new Map();
function generateNotAvailableVtt(lang) {
  const isAr = lang === "ar";
  const message = isAr ? "\u0639\u0630\u0631\u0627\u064B\u060C \u0644\u0627 \u062A\u062A\u0648\u0641\u0631 \u062A\u0631\u062C\u0645\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u0644 \u062D\u0627\u0644\u064A\u0627\u064B." : "Sorry, no verified subtitles are currently available for this title.";
  let vtt = "WEBVTT\n\n";
  const intervalSec = 300;
  const cueDurationSec = 8;
  let idx = 1;
  for (let start = 1; start < 3 * 3600; start += intervalSec) {
    const end = start + cueDurationSec;
    vtt += `${idx}
${formatVttTime(start)} --> ${formatVttTime(end)}
${message}

`;
    idx++;
  }
  return vtt;
}
function formatVttTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor(totalSeconds % 3600 / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}.000`;
}
function srtToVtt(srtText) {
  let clean = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let vtt = "WEBVTT\n\n";
  const timestampRegex = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;
  clean = clean.replace(timestampRegex, "$1.$2");
  vtt += clean;
  return vtt;
}
async function fetchAndBypassCorsSubtitles(url, lang) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(6e3)
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return null;
    let body = decodeSubtitleBuffer(Buffer.from(arrayBuffer), lang === "ar" || lang === "en" ? lang : void 0);
    if (!body || body.trim().length === 0) return null;
    if (lang === "ar" && !/[\u0600-\u06FF]/.test(body)) {
      console.warn(`[Subtitles Proxy] External URL content does not contain valid Arabic script. Rejecting corrupted file.`);
      return null;
    }
    if (!body.includes("WEBVTT") && body.includes("-->")) {
      body = srtToVtt(body);
    }
    return body;
  } catch (err) {
    console.error("[Subtitles Proxy] Error fetching external subtitle:", err.message);
    return null;
  }
}
function adjustVttTimestamps(vttText, offsetSec) {
  if (offsetSec === 0 || isNaN(offsetSec)) return vttText;
  const timestampRegex = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g;
  return vttText.replace(timestampRegex, (match, hh, mm, ss, ms) => {
    let totalMs = (parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseInt(ss, 10)) * 1e3 + parseInt(ms, 10);
    totalMs += offsetSec * 1e3;
    if (totalMs < 0) totalMs = 0;
    const newH = Math.floor(totalMs / 36e5);
    const newM = Math.floor(totalMs % 36e5 / 6e4);
    const newS = Math.floor(totalMs % 6e4 / 1e3);
    const newMs = totalMs % 1e3;
    const pad = (num, size) => String(num).padStart(size, "0");
    return `${pad(newH, 2)}:${pad(newM, 2)}:${pad(newS, 2)}.${pad(newMs, 3)}`;
  });
}
app.get("/api/subtitles", async (req, res) => {
  const movieId = req.query.movieId;
  const seasonId = req.query.seasonId;
  const episodeId = req.query.episodeId;
  const lang = (req.query.lang || "ar").toLowerCase();
  const offsetSec = parseFloat(req.query.offset || "0");
  if (!movieId) {
    return res.status(400).send("Movie ID is required");
  }
  const baseCacheKey = `${movieId}_${seasonId || ""}_${episodeId || ""}_${lang}`;
  if (subtitlesCache.has(baseCacheKey)) {
    const cachedVtt = subtitlesCache.get(baseCacheKey);
    if (lang === "ar" && !/[\u0600-\u06FF]/.test(cachedVtt)) {
      console.warn(`[Subtitles API] Invalidation: Cached subtitle for ${baseCacheKey} is missing Arabic text. Regenerating...`);
      subtitlesCache.delete(baseCacheKey);
    } else {
      const finalVtt2 = adjustVttTimestamps(cachedVtt, offsetSec);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send(finalVtt2);
    }
  }
  let movie = moviesDatabase.find((m) => m.id === movieId);
  if (!movie) {
    const promo = defaultPromos.find((p) => p.id === movieId) || customPromos.find((p) => p.id === movieId);
    if (promo) {
      movie = moviesDatabase.find((m) => m.titleEn.toLowerCase().includes(promo.titleEn.toLowerCase()) || promo.titleAr && m.titleAr.includes(promo.titleAr));
    }
  }
  let title = movie ? movie.titleEn : defaultPromos.find((p) => p.id === movieId)?.titleEn || movieId;
  let externalUrl = void 0;
  if (movie) {
    if (movie.type === "series" && movie.seasons && seasonId && episodeId) {
      const season = movie.seasons.find((s) => s.id === seasonId);
      if (season && season.episodes) {
        const episode = season.episodes.find((e) => e.id === episodeId);
        if (episode) {
          title = `${movie.titleEn} - Season ${season.number} Episode ${episode.number}: ${episode.titleEn || ""}`;
          const epSub = lang === "ar" ? episode.subtitlesUrlAr : episode.subtitlesUrlEn;
          const epOrig = lang === "ar" ? episode.originalSubtitlesUrlAr : episode.originalSubtitlesUrlEn;
          if (epSub && (epSub.startsWith("/uploads/") || epSub.startsWith("data:") || epSub.startsWith("blob:"))) {
            externalUrl = epSub;
          } else if (epOrig && (epOrig.startsWith("/uploads/") || epOrig.startsWith("http://") || epOrig.startsWith("https://"))) {
            externalUrl = epOrig;
          } else if (epSub && !epSub.startsWith("/api/subtitles?")) {
            externalUrl = epSub;
          }
        }
      }
    } else {
      const movSub = lang === "ar" ? movie.subtitlesUrlAr : movie.subtitlesUrlEn;
      const movOrig = lang === "ar" ? movie.originalSubtitlesUrlAr : movie.originalSubtitlesUrlEn;
      if (movSub && (movSub.startsWith("/uploads/") || movSub.startsWith("data:") || movSub.startsWith("blob:"))) {
        externalUrl = movSub;
      } else if (movOrig && (movOrig.startsWith("/uploads/") || movOrig.startsWith("http://") || movOrig.startsWith("https://"))) {
        externalUrl = movOrig;
      } else if (movSub && !movSub.startsWith("/api/subtitles?")) {
        externalUrl = movSub;
      }
    }
  }
  const subtitleTarget = movie && movie.type === "series" && movie.seasons && seasonId && episodeId ? movie.seasons.find((s) => s.id === seasonId)?.episodes?.find((e) => e.id === episodeId) : movie;
  const persistFoundUrl = (foundUrl, forLang = lang) => {
    if (!movie) return;
    if (movie.type === "series" && movie.seasons && seasonId && episodeId) {
      const season = movie.seasons.find((s) => s.id === seasonId);
      const episode = season?.episodes?.find((e) => e.id === episodeId);
      if (episode) {
        if (forLang === "ar") {
          episode.originalSubtitlesUrlAr = foundUrl;
          episode.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&seasonId=${seasonId}&episodeId=${episodeId}&lang=ar`;
          episode.subtitleSearchFailedAtAr = void 0;
        } else {
          episode.originalSubtitlesUrlEn = foundUrl;
          episode.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&seasonId=${seasonId}&episodeId=${episodeId}&lang=en`;
          episode.subtitleSearchFailedAtEn = void 0;
        }
      }
    } else {
      if (forLang === "ar") {
        movie.originalSubtitlesUrlAr = foundUrl;
        movie.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&lang=ar`;
        movie.subtitleSearchFailedAtAr = void 0;
      } else {
        movie.originalSubtitlesUrlEn = foundUrl;
        movie.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&lang=en`;
        movie.subtitleSearchFailedAtEn = void 0;
      }
    }
    saveMoviesDatabase();
  };
  const loadCandidateUrl = async (candidateUrl) => {
    if (candidateUrl.startsWith("/uploads/") || candidateUrl.includes("uploads/")) {
      try {
        const fileName = import_path2.default.basename(candidateUrl);
        const filePath = import_path2.default.join(process.cwd(), "uploads", fileName);
        if (import_fs.default.existsSync(filePath)) {
          let content = import_fs.default.readFileSync(filePath, "utf8");
          if (filePath.endsWith(".srt") || !content.includes("WEBVTT") && content.includes("-->")) {
            content = srtToVtt(content);
          }
          return content;
        }
      } catch (err) {
        console.error("[Subtitles API] Failed to load local uploaded subtitle file:", err.message);
      }
      return null;
    }
    if (candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://")) {
      return await fetchAndBypassCorsSubtitles(candidateUrl, lang);
    }
    return null;
  };
  let finalRawVtt = "";
  if (externalUrl) {
    finalRawVtt = await loadCandidateUrl(externalUrl) || "";
    if (!finalRawVtt) {
      console.warn(`[Subtitles API] Stored subtitle URL failed to load or is no longer valid, will re-search: ${externalUrl}`);
    }
  }
  const NEGATIVE_CACHE_MS = 24 * 60 * 60 * 1e3;
  const failedAtField = lang === "ar" ? "subtitleSearchFailedAtAr" : "subtitleSearchFailedAtEn";
  const failedAt = subtitleTarget?.[failedAtField];
  const recentlyFailed = failedAt && Date.now() - new Date(failedAt).getTime() < NEGATIVE_CACHE_MS;
  if (!finalRawVtt && recentlyFailed) {
    console.log(`[Subtitles API] Skipping live search for "${title}" (${lang}) - a search already failed within the last 24h.`);
  }
  if (!finalRawVtt && !recentlyFailed) {
    try {
      console.log(`[Subtitles API] No usable subtitle for "${title}" (${lang}). Triggering live real-source search...`);
      const year = movie ? movie.year : (/* @__PURE__ */ new Date()).getFullYear();
      const type = movie ? movie.type : "movie";
      const subs = await findSubtitlesForWork(movie ? movie.titleEn : title, year, type);
      const foundUrl = lang === "ar" ? subs.ar : subs.en;
      const otherLang = lang === "ar" ? "en" : "ar";
      const otherFoundUrl = lang === "ar" ? subs.en : subs.ar;
      if (otherFoundUrl) persistFoundUrl(otherFoundUrl, otherLang);
      if (foundUrl) {
        console.log(`[Subtitles API] Live search found a verified real subtitle: ${foundUrl}`);
        finalRawVtt = await loadCandidateUrl(foundUrl) || "";
        if (finalRawVtt) persistFoundUrl(foundUrl);
      }
      if (!foundUrl && subtitleTarget) {
        subtitleTarget[failedAtField] = (/* @__PURE__ */ new Date()).toISOString();
        saveMoviesDatabase();
      }
    } catch (searchErr) {
      console.warn(`[Subtitles API] Live subtitle search failed:`, searchErr);
    }
  }
  if (!finalRawVtt) {
    console.log(`[Subtitles API] No real subtitle could be found for "${title}" (${lang}). Returning an honest not-available notice.`);
    const finalVtt2 = generateNotAvailableVtt(lang);
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    return res.send(finalVtt2);
  }
  subtitlesCache.set(baseCacheKey, finalRawVtt);
  const finalVtt = adjustVttTimestamps(finalRawVtt, offsetSec);
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  return res.send(finalVtt);
});
var sortMoviesByPart = (movies) => {
  const groups = {};
  movies.forEach((m) => {
    if (m.collectionId) {
      if (!groups[m.collectionId]) {
        groups[m.collectionId] = [];
      }
      groups[m.collectionId].push(m);
    }
  });
  Object.keys(groups).forEach((cid) => {
    groups[cid].sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0));
  });
  const result = [];
  const renderedCollections = /* @__PURE__ */ new Set();
  movies.forEach((m) => {
    if (m.collectionId) {
      if (!renderedCollections.has(m.collectionId)) {
        renderedCollections.add(m.collectionId);
        result.push(...groups[m.collectionId]);
      }
    } else {
      result.push(m);
    }
  });
  return result;
};
var expandSearchResultsWithCollections = (results, database) => {
  const expanded = [];
  const addedIds = /* @__PURE__ */ new Set();
  results.forEach((m) => {
    if (!addedIds.has(m.id)) {
      expanded.push(m);
      addedIds.add(m.id);
    }
    if (m.collectionId) {
      const collectionParts = database.filter((dbMovie) => dbMovie.collectionId === m.collectionId);
      collectionParts.forEach((part) => {
        if (!addedIds.has(part.id)) {
          expanded.push(part);
          addedIds.add(part.id);
        }
      });
    }
  });
  return sortMoviesByPart(expanded);
};
app.get("/api/movies", async (req, res) => {
  try {
    if (ai) {
      const now = Date.now();
      if (!cachedHomeData || now - lastCacheTime > CACHE_DURATION) {
        fetchHomeMoviesFromGemini().catch(console.error);
      }
    }
    moviesDatabase.forEach((movie) => {
      enrichMovieMetadata(movie);
    });
    const publishedDatabase = moviesDatabase.filter(
      (m) => !isMovieDeleted(m.id, m.titleAr, m.titleEn) && m.isPublished !== false
    );
    const recentlyAdded = publishedDatabase.slice().reverse();
    const trending = customTrendingIds.length > 0 ? customTrendingIds.map((id) => publishedDatabase.find((m) => m.id === id)).filter((m) => !!m) : publishedDatabase.filter((m) => m.rating >= 8.5);
    const action = publishedDatabase.filter((m) => m.genres.includes("\u0623\u0643\u0634\u0646") || m.genres.includes("\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A") || m.genres.includes("Action") || m.genres.includes("Sci-Fi"));
    const series = publishedDatabase.filter((m) => m.type === "series");
    const moviesOnly = publishedDatabase.filter((m) => m.type === "movie");
    const heroMovie = customHeroId ? publishedDatabase.find((m) => m.id === customHeroId) || publishedDatabase[0] : publishedDatabase[0];
    const latest10 = recentlyAdded.slice(0, 10);
    res.json({
      hero: heroMovie,
      heroMovies: latest10,
      promos: customPromos.length > 0 ? customPromos : defaultPromos,
      categories: [
        { id: "recent", titleAr: "\u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0627\u0644\u0645\u0636\u0627\u0641\u0629 \u062D\u062F\u064A\u062B\u0627\u064B", titleEn: "Recently Added", items: sortMoviesByPart(recentlyAdded) },
        { id: "trending", titleAr: "\u0627\u0644\u0623\u0643\u062B\u0631 \u0645\u0634\u0627\u0647\u062F\u0629 \u0648\u0627\u0644\u0623\u0639\u0644\u0649 \u062A\u0642\u064A\u064A\u0645\u0627\u064B", titleEn: "Trending & Top Rated", items: sortMoviesByPart(trending) },
        { id: "series", titleAr: "\u0623\u062D\u062F\u062B \u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0648\u0627\u0644\u0628\u0631\u0627\u0645\u062C", titleEn: "Latest Series", items: sortMoviesByPart(series) },
        { id: "action", titleAr: "\u0623\u0641\u0644\u0627\u0645 \u0627\u0644\u0623\u0643\u0634\u0646 \u0648\u0627\u0644\u062E\u064A\u0627\u0644 \u0627\u0644\u0639\u0644\u0645\u064A", titleEn: "Action & Sci-Fi", items: sortMoviesByPart(action) },
        { id: "movies", titleAr: "\u0623\u0641\u0644\u0627\u0645 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0645\u0645\u064A\u0632\u0629", titleEn: "Featured Movies", items: sortMoviesByPart(moviesOnly) }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post(["/api/cinemana/import-batch", "/api/import/cinemana-tmdb"], async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 15;
    const query = req.body.query || req.body.forceQuery || "";
    console.log(`[API Endpoint] Manual request to trigger Cinemana + TMDB import batch (limit: ${limit}, query: "${query}")...`);
    const result = await importBatchFromCinemanaAndTMDB({ limit, forceQuery: query });
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: "error", error: error.message || "Failed to run import batch" });
  }
});
app.get("/api/cinemana/import-status", (req, res) => {
  const nextRunMinutes = cinemanaImportStats.lastRunTimestamp ? Math.max(1, Math.round(60 - (Date.now() - cinemanaImportStats.lastRunTimestamp) / 6e4)) : 60;
  res.json({
    status: "active",
    schedule: "Automated hourly import (15 items per batch)",
    stats: {
      ...cinemanaImportStats,
      nextScheduledRunInMinutes: nextRunMinutes,
      totalMoviesAndSeriesInDb: moviesDatabase.length,
      firestoreSynced: true
    }
  });
});
app.get("/api/admin/data", (req, res) => {
  res.json({
    movies: moviesDatabase,
    customHeroId,
    customTrendingIds,
    customPromos: customPromos.length > 0 ? customPromos : defaultPromos
  });
});
app.post("/api/admin/movies", async (req, res) => {
  try {
    const movie = req.body;
    if (!movie.titleAr && movie.titleEn) movie.titleAr = movie.titleEn;
    if (!movie.titleEn && movie.titleAr) movie.titleEn = movie.titleAr;
    if (!movie.titleAr || !movie.titleEn) {
      return res.status(400).json({ error: "\u0627\u0644\u0631\u062C\u0627\u0621 \u0625\u062F\u062E\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u0644 (\u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0623\u0648 \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629)" });
    }
    if (!movie.type) movie.type = "movie";
    if (movie.type === "movie") {
      const existingMovie = findDuplicateMovieOrSeries(movie.titleAr, movie.titleEn, movie.id, "movie");
      if (existingMovie) {
        console.log(`[Admin Movie Add] Rejected duplicate import: "${movie.titleAr || movie.titleEn}" already exists as ${existingMovie.id}`);
        return res.status(409).json({
          error: `\u0647\u0630\u0627 \u0627\u0644\u0641\u0644\u0645 \u0645\u0648\u062C\u0648\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A ("${existingMovie.titleAr}")\u060C \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0633\u062A\u064A\u0631\u0627\u062F\u0647 \u0623\u0648 \u0625\u0636\u0627\u0641\u062A\u0647 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649.`,
          existingMovieId: existingMovie.id
        });
      }
    }
    if (!movie.id) {
      const prefix = movie.type === "series" ? "series_" : "movie_";
      movie.id = prefix + Date.now();
    }
    movie.rating = parseFloat(movie.rating) || 8;
    movie.year = parseInt(movie.year) || (/* @__PURE__ */ new Date()).getFullYear();
    if (!Array.isArray(movie.genres)) movie.genres = [];
    if (!Array.isArray(movie.actors)) movie.actors = [];
    if (!Array.isArray(movie.servers)) movie.servers = [];
    if (movie.type === "movie" && movie.servers.length === 0) {
      movie.servers = [{ name: "\u0633\u064A\u0631\u0641\u0631 \u0631\u0626\u064A\u0633\u064A 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }];
    }
    movie.subtitlesUrlAr = getValidSubtitleUrl(movie.subtitlesUrlAr, movie.id, "ar", void 0, void 0, movie);
    movie.subtitlesUrlEn = getValidSubtitleUrl(movie.subtitlesUrlEn, movie.id, "en", void 0, void 0, movie);
    if (movie.type === "series" && movie.seasons) {
      movie.seasons.forEach((season) => {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          season.episodes.forEach((episode) => {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;
            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, movie.id, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, movie.id, "en", sId, eId, episode);
          });
        }
      });
    }
    try {
      const healTimeout = (ms, promise, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
      const defaultPoster = movie.poster && movie.poster.startsWith("http") ? movie.poster : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80";
      const defaultBackdrop = movie.backdrop && movie.backdrop.startsWith("http") ? movie.backdrop : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";
      movie.poster = await healTimeout(2500, verifyAndCorrectImageUrl(movie.poster, movie.titleEn || movie.titleAr, false, movie.genres), defaultPoster);
      movie.backdrop = await healTimeout(2500, verifyAndCorrectImageUrl(movie.backdrop, movie.titleEn || movie.titleAr, true, movie.genres), defaultBackdrop);
    } catch (imgErr) {
      console.warn("[Admin Movie Add] Image healing skipped due to error:", imgErr);
    }
    if (movie.type === "series") {
      const cleanRoots = getSeriesRootTitle(movie.titleAr, movie.titleEn);
      const existingSeries = findDuplicateMovieOrSeries(cleanRoots.rootAr, cleanRoots.rootEn, movie.id, "series");
      if (existingSeries) {
        console.log(`[Admin Movie Add] Merging incoming seasons into existing series "${existingSeries.titleAr}"`);
        if (!existingSeries.seasons) existingSeries.seasons = [];
        const incomingSeasons = movie.seasons && movie.seasons.length > 0 ? movie.seasons : [{
          id: `s1_${Date.now()}`,
          number: 1,
          titleAr: "\u0627\u0644\u0645\u0648\u0633\u0645 1",
          titleEn: "Season 1",
          poster: movie.poster,
          backdrop: movie.backdrop,
          episodes: []
        }];
        for (const incSzn of incomingSeasons) {
          const exSzn = existingSeries.seasons.find((s) => s.number === incSzn.number);
          if (exSzn) {
            if (incSzn.poster) exSzn.poster = incSzn.poster;
            if (incSzn.storyAr) exSzn.storyAr = incSzn.storyAr;
            if (incSzn.storyEn) exSzn.storyEn = incSzn.storyEn;
            if (incSzn.episodes && incSzn.episodes.length > 0) {
              for (const ep of incSzn.episodes) {
                if (!exSzn.episodes.some((e) => e.number === ep.number || e.id === ep.id)) {
                  exSzn.episodes.push(ep);
                }
              }
              exSzn.episodes.sort((a, b) => a.number - b.number);
            }
          } else {
            existingSeries.seasons.push(incSzn);
          }
        }
        existingSeries.seasons.sort((a, b) => a.number - b.number);
        saveMoviesDatabase();
        saveMovieToFirestore(existingSeries).catch(console.error);
        return res.status(200).json({ success: true, movie: existingSeries });
      }
      movie.titleAr = cleanRoots.rootAr;
      movie.titleEn = cleanRoots.rootEn;
    }
    moviesDatabase.push(movie);
    unmarkMovieAsDeleted(movie.id, movie.titleAr, movie.titleEn);
    subtitlesCache.clear();
    saveMoviesDatabase();
    saveMovieToFirestore(movie).catch(console.error);
    res.status(201).json({ success: true, movie });
  } catch (error) {
    console.error("[Admin Movie Add Error]:", error);
    res.status(500).json({ error: error.message || "\u0641\u0634\u0644\u062A \u0639\u0645\u0644\u064A\u0629 \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0639\u0645\u0644" });
  }
});
app.put("/api/admin/movies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const index = moviesDatabase.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Movie not found" });
    }
    const updatedMovie = { ...moviesDatabase[index], ...req.body };
    if (!updatedMovie.titleAr && updatedMovie.titleEn) updatedMovie.titleAr = updatedMovie.titleEn;
    if (!updatedMovie.titleEn && updatedMovie.titleAr) updatedMovie.titleEn = updatedMovie.titleAr;
    updatedMovie.rating = parseFloat(updatedMovie.rating) || 8;
    updatedMovie.year = parseInt(updatedMovie.year) || (/* @__PURE__ */ new Date()).getFullYear();
    if (!Array.isArray(updatedMovie.genres)) updatedMovie.genres = [];
    if (!Array.isArray(updatedMovie.actors)) updatedMovie.actors = [];
    if (!Array.isArray(updatedMovie.servers)) updatedMovie.servers = [];
    updatedMovie.subtitlesUrlAr = getValidSubtitleUrl(updatedMovie.subtitlesUrlAr, updatedMovie.id, "ar", void 0, void 0, updatedMovie);
    updatedMovie.subtitlesUrlEn = getValidSubtitleUrl(updatedMovie.subtitlesUrlEn, updatedMovie.id, "en", void 0, void 0, updatedMovie);
    if (updatedMovie.type === "series" && updatedMovie.seasons) {
      updatedMovie.seasons.forEach((season) => {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          season.episodes.forEach((episode) => {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;
            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, updatedMovie.id, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, updatedMovie.id, "en", sId, eId, episode);
          });
        }
      });
    }
    try {
      const healTimeout = (ms, promise, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);
      const defaultPoster = updatedMovie.poster && updatedMovie.poster.startsWith("http") ? updatedMovie.poster : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80";
      const defaultBackdrop = updatedMovie.backdrop && updatedMovie.backdrop.startsWith("http") ? updatedMovie.backdrop : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";
      updatedMovie.poster = await healTimeout(2500, verifyAndCorrectImageUrl(updatedMovie.poster, updatedMovie.titleEn || updatedMovie.titleAr, false, updatedMovie.genres), defaultPoster);
      updatedMovie.backdrop = await healTimeout(2500, verifyAndCorrectImageUrl(updatedMovie.backdrop, updatedMovie.titleEn || updatedMovie.titleAr, true, updatedMovie.genres), defaultBackdrop);
    } catch (imgErr) {
      console.warn("[Admin Movie Edit] Image healing skipped due to error:", imgErr);
    }
    moviesDatabase[index] = updatedMovie;
    unmarkMovieAsDeleted(updatedMovie.id, updatedMovie.titleAr, updatedMovie.titleEn);
    subtitlesCache.clear();
    saveMoviesDatabase();
    saveMovieToFirestore(updatedMovie).catch(console.error);
    res.json({ success: true, movie: updatedMovie });
  } catch (error) {
    console.error("[Admin Movie Edit Error]:", error);
    res.status(500).json({ error: error.message || "\u0641\u0634\u0644\u062A \u0639\u0645\u0644\u064A\u0629 \u062D\u0641\u0638 \u0627\u0644\u062A\u0639\u062F\u064A\u0644\u0627\u062A" });
  }
});
app.post("/api/admin/movies/toggle-publish", async (req, res) => {
  try {
    const { id, isPublished } = req.body;
    const movie = moviesDatabase.find((m) => m.id === id);
    if (!movie) {
      return res.status(404).json({ error: "\u0627\u0644\u0639\u0645\u0644 \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F" });
    }
    movie.isPublished = isPublished !== void 0 ? Boolean(isPublished) : !(movie.isPublished !== false);
    saveMoviesDatabase();
    saveMovieToFirestore(movie).catch(console.error);
    cachedHomeData = null;
    res.json({
      success: true,
      movie,
      message: movie.isPublished ? "\u062A\u0645 \u0646\u0634\u0631 \u0627\u0644\u0639\u0645\u0644 \u0628\u0646\u062C\u0627\u062D \u0644\u064A\u0635\u0628\u062D \u0645\u0639\u0631\u0648\u0636\u0627\u064B \u0644\u0644\u062C\u0645\u0647\u0648\u0631!" : "\u062A\u0645 \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0639\u0645\u0644 \u0625\u0644\u0649 \u0642\u0627\u0626\u0645\u0629 \u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629"
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "\u0641\u0634\u0644\u062A \u0639\u0645\u0644\u064A\u0629 \u062A\u063A\u064A\u064A\u0631 \u062D\u0627\u0644\u0629 \u0627\u0644\u0646\u0634\u0631" });
  }
});
app.post("/api/admin/movies/publish-batch", async (req, res) => {
  try {
    const { ids, publishAll } = req.body;
    let publishedCount = 0;
    moviesDatabase.forEach((movie) => {
      if (publishAll || Array.isArray(ids) && ids.includes(movie.id)) {
        if (movie.isPublished === false) {
          movie.isPublished = true;
          publishedCount++;
          saveMovieToFirestore(movie).catch(console.error);
        }
      }
    });
    if (publishedCount > 0) {
      saveMoviesDatabase();
      cachedHomeData = null;
    }
    res.json({
      success: true,
      count: publishedCount,
      message: `\u062A\u0645 \u0646\u0634\u0631 \u0648\u062A\u0641\u0639\u064A\u0644 ${publishedCount} \u0639\u0645\u0644 \u0628\u0646\u062C\u0627\u062D!`
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "\u0641\u0634\u0644\u062A \u0639\u0645\u0644\u064A\u0629 \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u062C\u0645\u0627\u0639\u064A" });
  }
});
app.delete("/api/admin/movies/:id", (req, res) => {
  try {
    const { id } = req.params;
    const index = moviesDatabase.findIndex((m) => m.id === id);
    if (index !== -1) {
      const targetMovie = moviesDatabase[index];
      markMovieAsDeleted(targetMovie);
      moviesDatabase.splice(index, 1);
    } else {
      markMovieAsDeleted({ id });
    }
    subtitlesCache.clear();
    cachedHomeData = null;
    if (customHeroId === id) {
      customHeroId = null;
    }
    customTrendingIds = customTrendingIds.filter((tid) => tid !== id);
    saveMoviesDatabase();
    saveConfig();
    deleteMovieFromFirestore(id).catch(console.error);
    saveConfigToFirestore().catch(console.error);
    res.json({ success: true, message: "Movie deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/admin/config", (req, res) => {
  try {
    const { customHeroId: newHeroId, customTrendingIds: newTrendingIds, customPromos: newPromos } = req.body;
    if (newHeroId !== void 0) {
      customHeroId = newHeroId;
    }
    if (newTrendingIds !== void 0 && Array.isArray(newTrendingIds)) {
      customTrendingIds = newTrendingIds;
    }
    if (newPromos !== void 0 && Array.isArray(newPromos)) {
      customPromos = newPromos;
    }
    saveConfig();
    saveConfigToFirestore().catch(console.error);
    res.json({ success: true, customHeroId, customTrendingIds, customPromos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/ads", (req, res) => {
  try {
    const activeAds = (adsSettings.ads || []).filter((a) => a.isActive !== false);
    res.json({
      enabled: adsSettings.enabled !== false,
      globalSkipAfterSeconds: adsSettings.globalSkipAfterSeconds || 5,
      allowSkip: adsSettings.allowSkip !== false,
      ads: activeAds
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/admin/ads", (req, res) => {
  try {
    res.json({ success: true, adsSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/admin/ads", (req, res) => {
  try {
    const { enabled, globalSkipAfterSeconds, allowSkip, ads } = req.body;
    if (enabled !== void 0) adsSettings.enabled = Boolean(enabled);
    if (globalSkipAfterSeconds !== void 0) adsSettings.globalSkipAfterSeconds = Number(globalSkipAfterSeconds);
    if (allowSkip !== void 0) adsSettings.allowSkip = Boolean(allowSkip);
    if (Array.isArray(ads)) adsSettings.ads = ads;
    saveConfig();
    saveConfigToFirestore().catch(console.error);
    res.json({ success: true, message: "\u062A\u0645 \u062D\u0641\u0638 \u0625\u0639\u062F\u0627\u062F\u0627\u062A \u0627\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062A \u0648\u0633\u064A\u0631\u0641\u0631\u0627\u062A \u0627\u0644\u0628\u062B \u0628\u0646\u062C\u0627\u062D", adsSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/admin/ads/upload-media", (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
      return res.status(400).json({ error: "\u0627\u0644\u0631\u062C\u0627\u0621 \u062A\u062D\u062F\u064A\u062F \u0627\u0644\u0645\u0644\u0641 \u0648\u0627\u0644\u0645\u062D\u062A\u0648\u0649" });
    }
    const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = import_path2.default.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `ad_${Date.now()}_${safeName}`;
    const filePath = import_path2.default.join(UPLOADS_DIR, uniqueName);
    let buffer;
    if (fileContent.startsWith("data:") && fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      buffer = Buffer.from(base64Data, "base64");
    } else {
      buffer = Buffer.from(fileContent, "utf8");
    }
    import_fs.default.writeFileSync(filePath, buffer);
    res.json({ success: true, url: `/uploads/${uniqueName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/admin/upload-subtitle", (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
      return res.status(400).json({ error: "Missing fileName or fileContent" });
    }
    const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = import_path2.default.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `${Date.now()}_${safeName}`;
    const filePath = import_path2.default.join(UPLOADS_DIR, uniqueName);
    let buffer;
    if (fileContent.startsWith("data:") && fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      buffer = Buffer.from(base64Data, "base64");
    } else {
      buffer = Buffer.from(fileContent, "utf8");
    }
    import_fs.default.writeFileSync(filePath, buffer);
    subtitlesCache.clear();
    res.json({ success: true, url: `/uploads/${uniqueName}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/proxy-subtitles", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: "Missing required parameter 'url'" });
    }
    const fetchResponse = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(8e3)
    });
    if (!fetchResponse.ok) {
      return res.status(fetchResponse.status).send(`Failed to fetch from remote: ${fetchResponse.statusText}`);
    }
    const arrayBuffer = await fetchResponse.arrayBuffer();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", fetchResponse.headers.get("Content-Type") || "text/plain; charset=utf-8");
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error("[Proxy Subtitles] Error:", error.message);
    return res.status(500).send(error.message);
  }
});
app.post("/api/admin/import-subsource", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Missing required parameter 'url'" });
    }
    console.log(`[Subsource Importer] Request for URL: ${url}`);
    const idMatch = url.match(/\/(\d+)\/?$/) || url.match(/-(\d+)\/?$/) || url.match(/id=(\d+)/);
    const id = idMatch ? idMatch[1] : null;
    let buffer = null;
    let fileName = "subtitle.srt";
    let downloadUrl = "";
    const tryUrls = [];
    if (id) {
      tryUrls.push(`https://api.subsource.net/api/download/${id}`);
      tryUrls.push(`https://subsource.net/subtitle/download-file/${id}`);
      tryUrls.push(`https://subsource.net/download/subtitle?id=${id}`);
    }
    tryUrls.push(url);
    for (const tryUrl of tryUrls) {
      try {
        console.log(`[Subsource Importer] Trying download from: ${tryUrl}`);
        const fetchRes = await fetch(tryUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "application/octet-stream, application/zip, */*"
          },
          signal: AbortSignal.timeout(1e4)
        });
        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get("content-type") || "";
          const contentDisposition = fetchRes.headers.get("content-disposition") || "";
          if (contentType.includes("text/html") && tryUrl === url && id) {
            continue;
          }
          const ab = await fetchRes.arrayBuffer();
          const tempBuf = Buffer.from(ab);
          if (tempBuf.length > 100) {
            buffer = tempBuf;
            downloadUrl = tryUrl;
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            if (filenameMatch) {
              fileName = filenameMatch[1];
            }
            break;
          }
        }
      } catch (err) {
        console.warn(`[Subsource Importer] Failed to fetch from ${tryUrl}:`, err.message);
      }
    }
    if (!buffer) {
      console.log(`[Subsource Importer] Direct URLs failed or no ID. Fetching page HTML...`);
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(1e4)
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const subIdMatch = html.match(/"id"\s*:\s*(\d+)/) || html.match(/download-file\/(\d+)/) || html.match(/subtitle\?id=(\d+)/) || html.match(/download\/(\d+)/);
        if (subIdMatch) {
          const extractedId = subIdMatch[1];
          console.log(`[Subsource Importer] Extracted ID from HTML: ${extractedId}`);
          const fallbackUrls = [
            `https://api.subsource.net/api/download/${extractedId}`,
            `https://subsource.net/subtitle/download-file/${extractedId}`,
            `https://subsource.net/download/subtitle?id=${extractedId}`
          ];
          for (const fUrl of fallbackUrls) {
            try {
              const fRes = await fetch(fUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
                }
              });
              if (fRes.ok) {
                const ab = await fRes.arrayBuffer();
                buffer = Buffer.from(ab);
                downloadUrl = fUrl;
                break;
              }
            } catch (e) {
            }
          }
        }
      }
    }
    if (!buffer) {
      return res.status(404).json({ error: "\u062A\u0639\u0630\u0631 \u062A\u062D\u0645\u064A\u0644 \u0645\u0644\u0641 \u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0645\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u0627\u0644\u0645\u0648\u0641\u0631. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0623\u0646 \u0627\u0644\u0631\u0627\u0628\u0637 \u0635\u062D\u064A\u062D \u0648\u064A\u0634\u064A\u0631 \u0644\u0635\u0641\u062D\u0629 \u062A\u0631\u062C\u0645\u0629 \u0635\u0627\u0644\u062D\u0629 \u0639\u0644\u0649 Subsource.net" });
    }
    if (buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4) {
      console.log("[Subsource Importer] ZIP file detected. Extracting...");
      try {
        const zip = new import_adm_zip.default(buffer);
        const zipEntries = zip.getEntries();
        const entry = zipEntries.find((e) => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
          console.log(`[Subsource Importer] Extracted file: ${fileName}`);
        } else {
          console.warn("[Subsource Importer] No .srt or .vtt file found in the ZIP archive.");
        }
      } catch (zipErr) {
        console.error("[Subsource Importer] Error unzipping file:", zipErr.message);
      }
    }
    const finalDecodedText = decodeSubtitleBuffer(buffer);
    console.log(`[Subsource Importer] Decoded ${finalDecodedText.length} characters, contains Arabic: ${/[\u0600-\u06FF]/.test(finalDecodedText)}`);
    const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
    if (!import_fs.default.existsSync(UPLOADS_DIR)) {
      import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const safeName = "subsource_" + Date.now() + "_" + import_path2.default.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = import_path2.default.join(UPLOADS_DIR, finalName);
    import_fs.default.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subsource Importer] Subtitle successfully saved to ${filePath}`);
    return res.json({ success: true, url: `/uploads/${finalName}` });
  } catch (error) {
    console.error("[Subsource Importer] Error:", error);
    return res.status(500).json({ error: error.message });
  }
});
app.post("/api/admin/auto-fetch-subtitles", async (req, res) => {
  try {
    const { titleEn, titleAr, year, imdbId, type } = req.body;
    if (!titleEn && !titleAr) {
      return res.status(400).json({ error: "Missing title parameter" });
    }
    const queryTitle = titleEn || titleAr;
    const queryYear = year || (/* @__PURE__ */ new Date()).getFullYear();
    console.log(`[Admin Auto-Subtitles] Searching real subtitles for "${queryTitle}" (${queryYear})...`);
    const subs = await findSubtitlesForWork(queryTitle, queryYear, type || "movie", imdbId);
    const arUrl = subs.ar || "";
    const enUrl = subs.en || "";
    const foundAny = Boolean(arUrl || enUrl);
    return res.json({
      success: foundAny,
      subtitlesUrlAr: arUrl,
      subtitlesUrlEn: enUrl,
      message: foundAny ? `\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062A\u0631\u062C\u0645\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0648\u062B\u0642\u0629: ${arUrl ? "\u0639\u0631\u0628\u064A " : ""}${enUrl ? "\u0625\u0646\u062C\u0644\u064A\u0632\u064A" : ""}`.trim() : "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u062A\u0631\u062C\u0645\u0629 \u062D\u0642\u064A\u0642\u064A\u0629 \u0645\u0648\u062B\u0642\u0629 \u0644\u0647\u0630\u0627 \u0627\u0644\u0639\u0645\u0644. \u0644\u0646 \u064A\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0623\u064A \u0645\u062D\u062A\u0648\u0649 \u0645\u0641\u0628\u0631\u0643 - \u064A\u0645\u0643\u0646\u0643 \u0631\u0641\u0639 \u0645\u0644\u0641 \u062A\u0631\u062C\u0645\u0629 \u064A\u062F\u0648\u064A\u0627\u064B \u0628\u062F\u0644\u0627\u064B \u0645\u0646 \u0630\u0644\u0643."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to auto-fetch subtitles" });
  }
});
app.post("/api/api/admin/sync-cinemana", async (req, res) => {
  return res.redirect(307, "/api/admin/sync-cinemana");
});
app.post("/api/admin/sync-cinemana", async (req, res) => {
  try {
    console.log("[Server] Manual Cinemana sync requested by admin. Preserving manually uploaded movies/series...");
    lastCacheTime = 0;
    fetchHomeMoviesFromGemini().catch((err) => console.error("[Server] Error in async Cinemana home fetch:", err));
    seedRealMoviesFromTMDB().catch((err) => console.error("[Server] Error in async TMDB background seeding:", err));
    return res.json({
      success: true,
      message: "\u062A\u0645 \u0628\u062F\u0621 \u0645\u0632\u0627\u0645\u0646\u0629 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0645\u062A\u0642\u062F\u0645\u0629 \u0648\u0627\u0633\u062A\u064A\u0631\u0627\u062F \u0623\u0643\u062B\u0631 \u0645\u0646 50 \u0639\u0645\u0644\u0627\u064B \u0633\u064A\u0646\u0645\u0627\u0626\u064A\u0627\u064B \u0648\u062A\u0644\u0641\u0632\u064A\u0648\u0646\u064A\u0627\u064B \u0639\u0627\u0644\u0645\u064A\u0627\u064B \u062D\u0642\u064A\u0642\u064A\u0627\u064B \u0641\u064A \u0627\u0644\u062E\u0644\u0641\u064A\u0629 \u0628\u0646\u062C\u0627\u062D\u060C \u0645\u0639 \u0627\u0644\u062D\u0641\u0627\u0638 \u0627\u0644\u0643\u0627\u0645\u0644 \u0639\u0644\u0649 \u0643\u0627\u0641\u0629 \u0627\u0644\u0623\u0641\u0644\u0627\u0645 \u0648\u0627\u0644\u0645\u0633\u0644\u0633\u0644\u0627\u062A \u0627\u0644\u062A\u064A \u062A\u0645 \u0631\u0641\u0639\u0647\u0627 \u0648\u062A\u062E\u0632\u064A\u0646\u0647\u0627 \u062F\u0627\u0626\u0645\u0627\u064B \u0641\u064A \u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A!"
    });
  } catch (err) {
    console.error("[Server] Manual Cinemana sync failed:", err);
    return res.status(500).json({ error: err.message || "\u062D\u062F\u062B \u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629." });
  }
});
app.post("/api/admin/import-url", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "Missing required parameter 'url'" });
  }
  if (!ai || Date.now() < quotaExceededUntil) {
    console.warn("[Importer] Gemini is currently cooling down/rate-limited. Falling back directly to TMDB scraper.");
    try {
      const scrapedData = await scrapeTMDBMetadata(url);
      if (scrapedData && scrapedData.titleEn && !scrapedData.poster?.includes("images.unsplash.com")) {
        console.log("[Importer] Direct fallback to TMDB scraper completed successfully!");
        return res.json({ success: true, data: scrapedData });
      }
    } catch (scrapeErr) {
      console.error("[Importer] Direct fallback to TMDB scraper failed:", scrapeErr);
    }
    return res.status(400).json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0641\u064A\u0644\u0645 \u0623\u0648 \u0645\u0633\u0644\u0633\u0644 \u062D\u0642\u064A\u0642\u064A \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0627\u0644\u0631\u0627\u0628\u0637 \u0639\u0644\u0649 TMDB. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u0627\u0633\u0645 \u0628\u062F\u0642\u0629 \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0631\u0627\u0628\u0637 TMDB \u0645\u0628\u0627\u0634\u0631." });
  }
  try {
    console.log(`[Importer] Processing import request for URL or Search query: ${url}`);
    const isUrl = url.startsWith("http://") || url.startsWith("https://");
    let contextHint = "";
    let htmlContent = "";
    if (isUrl) {
      if (url.includes("imdb.com")) {
        const match = url.match(/title\/(tt\d+)/);
        if (match) {
          contextHint = `IMDb ID detected: ${match[1]}. Please query Google Search for "IMDb ${match[1]}" or "TMDB ${match[1]}" to get exact movie/series details including English and Arabic titles, release year, duration, and poster.`;
        }
      } else if (url.includes("cinemana")) {
        const movieMatch = url.match(/movie\/(\d+)/);
        const showMatch = url.match(/show\/(\d+)/);
        const videoMatch = url.match(/video\/(\d+)/);
        const id = movieMatch?.[1] || showMatch?.[1] || videoMatch?.[1];
        if (id) {
          contextHint = `Cinemana item detected with ID: ${id}. Please query Google Search for "Cinemana ${id}" or "\u0633\u064A\u0646\u0645\u0627\u0646\u0627 ${id}" to retrieve the exact film or show name and its respective Arabic/English details.`;
        }
      }
      try {
        const fetchResponse = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(8e3)
        });
        if (fetchResponse.ok) {
          htmlContent = await fetchResponse.text();
          htmlContent = htmlContent.substring(0, 2e4);
        }
      } catch (fetchErr) {
        console.warn(`[Importer] Failed to fetch HTML from URL ${url}: ${fetchErr.message}`);
      }
    } else {
      contextHint = `Direct movie/series search query: "${url}". Please search Google for this movie/series to locate its official details, IMDb page, or TMDB page, and construct a highly accurate and professional metadata report.`;
    }
    if (!ai) {
      return res.status(500).json({ error: "Gemini client is not initialized. Please verify GEMINI_API_KEY." });
    }
    const researchPrompt = `You are an expert movie and series researcher.
We need to gather accurate and complete metadata for the movie or series based on the following input.
Input: ${url}
Is Input a URL?: ${isUrl ? "Yes" : "No, this is a direct movie/series title search query."}
Search Context Hint: ${contextHint}
Parsed HTML content: ${htmlContent ? htmlContent.substring(0, 8e3) : "None available. You MUST search Google to find out what this refers to."}

Tasks:
1. Identify the exact movie or series name (both Arabic and English).
2. Use Google Search grounding to find the official information on IMDb, TMDB, or Wikipedia.
3. Retrieve and write down:
   - Localized Arabic Title and Official English Title
   - Release year
   - Content Type (movie or series)
   - IMDb / TMDB Rating
   - Runtime duration (e.g., "2h 15m" or "45m")
   - Main genres in Arabic (choose from: \u0623\u0643\u0634\u0646, \u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A, \u0645\u063A\u0627\u0645\u0631\u0629, \u062F\u0631\u0627\u0645\u0627, \u0643\u0648\u0645\u064A\u062F\u064A\u0627, \u0631\u0639\u0628, \u062C\u0631\u064A\u0645\u0629, \u062A\u0634\u0648\u064A\u0642, \u0648\u062B\u0627\u0626\u0642\u064A, \u0639\u0627\u0626\u0644\u064A, \u062E\u064A\u0627\u0644)
   - A high-quality vertical poster image URL and horizontal backdrop/fanart image URL (from TMDB, IMDb, or another public high-quality movie source)
   - Professional Arabic synopsis and English synopsis (Do not output machine translations, make it sound premium and professional)
   - Main cast/actors (4-5 names in English)
   - Official YouTube trailer watch link (e.g. https://www.youtube.com/watch?v=...)
   - Subtitle file URLs (Arabic and English) at both the movie/series level AND for each episode of a series. Search real public subtitle databases (e.g. opensubtitles.com, subsource.net, subdl.com, GitHub, Archive.org) via Google Search grounding and report only URLs that actually appeared in real search results. If no real subtitle URL was found in the search results, state that none was found rather than inventing one - downstream code will independently verify every URL before it is trusted.
   - A single working video stream URL from Cinemana. If the input is a Cinemana URL, extract its numeric ID and build a single server direct stream URL using: https://video.shabakaty.com/movies/{id}/index.m3u8 (or for episodes: https://video.shabakaty.com/movies/{series_id}/{season_number}/{episode_number}/index.m3u8). Otherwise, provide exactly one direct Cinemana URL based on the TMDB/IMDb ID or movie details. Always provide exactly one server in the result.
   - If it is a series, find the seasons and episodes list with names, durations, summaries, specific episode ratings, and episode-specific Arabic & English subtitle URLs.

Write a comprehensive, factual research report containing all these details.`;
    console.log("[Importer] Launching Step 1 (Research with Google Search grounding)...");
    let researchReport = "";
    try {
      const researchResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: researchPrompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      researchReport = researchResponse.text || "No details found.";
      console.log("[Importer] Step 1 (with search grounding) Completed. Research Report Length:", researchReport.length);
    } catch (groundingError) {
      console.warn("[Importer] Step 1 with search grounding failed, falling back to direct content generation:", groundingError.message);
      try {
        const fallbackPrompt = `${researchPrompt}

(Note: Google Search grounding is currently unavailable. Please use your internal pre-trained database of movies/series to construct this factual report based on the provided URL, title, or ID.)`;
        const fallbackResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: fallbackPrompt
        });
        researchReport = fallbackResponse.text || "No details found.";
        console.log("[Importer] Step 1 (Fallback without grounding) Completed. Research Report Length:", researchReport.length);
      } catch (fallbackError) {
        console.error("[Importer] Both grounding and direct fallback failed for Step 1:", fallbackError);
        throw fallbackError;
      }
    }
    const formattingPrompt = `You are a professional metadata parser.
We have a research report for a movie or series:
----------------------------------
${researchReport}
----------------------------------

Your task is to parse this research report and structure it into a perfect, pure JSON object matching this structure:
{
  "titleAr": "Arabic title of the film/series",
  "titleEn": "English title of the film/series",
  "type": "movie" or "series",
  "rating": 8.5,
  "year": 2024,
  "duration": "Duration (e.g. '2h 15m' or '45m')",
  "ageRating": "Age classification rating (e.g., 'PG-13', 'R', 'TV-MA', 'G', 'PG', '+18', '+16', etc.)",
  "genres": ["\u0623\u0643\u0634\u0646", "\u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A", "\u0645\u063A\u0627\u0645\u0631\u0629"], (Choose from: \u0623\u0643\u0634\u0646, \u062E\u064A\u0627\u0644 \u0639\u0644\u0645\u064A, \u0645\u063A\u0627\u0645\u0631\u0629, \u062F\u0631\u0627\u0645\u0627, \u0643\u0648\u0645\u064A\u062F\u064A\u0627, \u0631\u0639\u0628, \u062C\u0631\u064A\u0645\u0629, \u062A\u0634\u0648\u064A\u0642, \u0648\u062B\u0627\u0626\u0642\u064A, \u0639\u0627\u0626\u0644\u064A, \u062E\u064A\u0627\u0644)
  "poster": "Vertical poster image URL. Ensure it is a valid, high-quality image URL.",
  "backdrop": "Horizontal backdrop image URL. Ensure it is a valid, high-quality image URL.",
  "logoUrl": "Title logo image URL (transparent PNG from TMDB, or empty string)",
  "storyAr": "Professional compelling Arabic synopsis.",
  "storyEn": "Professional English synopsis.",
  "actors": ["Actor 1", "Actor 2", "Actor 3", "Actor 4"],
  "quality": "Ultra HD",
  "subtitlesUrlAr": "Arabic subtitle track URL (.vtt or .srt, or empty string)",
  "subtitlesUrlEn": "English subtitle track URL (.vtt or .srt, or empty string)",
  "trailerUrl": "Official YouTube watch link (e.g., https://www.youtube.com/watch?v=...)",
  "servers": [
    { "name": "\u0633\u064A\u0631\u0641\u0631 \u0633\u064A\u0646\u0645\u0627\u0646\u0627 \u0627\u0644\u0631\u0626\u064A\u0633\u064A", "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
  ],
  "seasons": [
    {
      "number": 1,
      "titleAr": "\u0627\u0644\u0645\u0648\u0633\u0645 \u0627\u0644\u0623\u0648\u0644",
      "titleEn": "Season 1",
      "episodes": [
        {
          "number": 1,
          "titleAr": "\u0627\u0644\u062D\u0644\u0642\u0629 \u0627\u0644\u0623\u0648\u0644\u0649",
          "titleEn": "Episode 1",
          "duration": "45m",
          "storyAr": "\u0645\u0644\u062E\u0635 \u0627\u0644\u062D\u0644\u0642\u0629 \u0627\u0644\u0623\u0648\u0644\u0649 \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629...",
          "storyEn": "Episode 1 English summary...",
          "thumbnail": "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&q=80",
          "subtitlesUrlAr": "Arabic subtitle track URL for this specific episode (.vtt or .srt, or empty string)",
          "subtitlesUrlEn": "English subtitle track URL for this specific episode (.vtt or .srt, or empty string)",
          "rating": 8.5,
          "servers": [
            { "name": "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A", "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
          ]
        }
      ]
    }
  ] (Only required when "type" is "series")
}

If "type" is "series", ensure you populate "seasons" with the seasons and episodes described in the report. If "type" is "movie", omit "seasons" entirely.
For "servers", ensure it contains EXACTLY ONE streaming server. Never put multiple servers. If the ID is known or found, use the direct Cinemana URL format (e.g., https://video.shabakaty.com/movies/{id}/index.m3u8).

IMPORTANT: For "subtitlesUrlAr" and "subtitlesUrlEn" (at both movie/series level and individual episode level), only populate them if the research report above actually contains a real subtitle URL it found via search. Otherwise return an empty string "". Never invent, guess, or construct a plausible-looking subtitle URL - every URL you return will be independently downloaded and verified, and a fabricated one will simply fail that check and waste the lookup.

CRITICAL: Return ONLY valid, pure JSON without any surrounding markdown code block characters or extra explanation.`;
    console.log("[Importer] Launching Step 2 (Formatting to JSON)...");
    let parsedData = {};
    try {
      const formatResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: formattingPrompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      let resultText = formatResponse.text?.trim() || "{}";
      if (resultText.includes("{")) {
        const start = resultText.indexOf("{");
        const end = resultText.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          resultText = resultText.substring(start, end + 1);
        }
      }
      parsedData = JSON.parse(resultText);
    } catch (formatError) {
      console.warn("[Importer] Step 2 JSON formatting failed, trying loose parsing without mimeType...", formatError.message);
      try {
        const formatResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `${formattingPrompt}

CRITICAL: Return ONLY the raw JSON object, starting with { and ending with }.`
        });
        let resultText = formatResponse.text?.trim() || "{}";
        if (resultText.includes("{")) {
          const start = resultText.indexOf("{");
          const end = resultText.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            resultText = resultText.substring(start, end + 1);
          }
        }
        parsedData = JSON.parse(resultText);
      } catch (fallbackFormatError) {
        console.error("[Importer] Formatting completely failed:", fallbackFormatError);
        throw new Error("\u0639\u0630\u0631\u0627\u064B\u060C \u0641\u0634\u0644 \u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0648\u0631\u062F\u0629 \u0645\u0646 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0644\u0627\u062D\u0642\u0627\u064B.");
      }
    }
    if (parsedData.subtitlesUrlAr && (parsedData.subtitlesUrlAr.startsWith("http://") || parsedData.subtitlesUrlAr.startsWith("https://"))) {
      const isValid = await verifySubtitleUrl(parsedData.subtitlesUrlAr, "ar");
      if (!isValid) {
        console.warn(`[Importer] Cleared unverified Arabic subtitle URL: ${parsedData.subtitlesUrlAr}`);
        parsedData.subtitlesUrlAr = "";
      }
    }
    if (parsedData.subtitlesUrlEn && (parsedData.subtitlesUrlEn.startsWith("http://") || parsedData.subtitlesUrlEn.startsWith("https://"))) {
      const isValid = await verifySubtitleUrl(parsedData.subtitlesUrlEn, "en");
      if (!isValid) {
        console.warn(`[Importer] Cleared unverified English subtitle URL: ${parsedData.subtitlesUrlEn}`);
        parsedData.subtitlesUrlEn = "";
      }
    }
    if (!parsedData.subtitlesUrlAr || !parsedData.subtitlesUrlEn) {
      try {
        console.log("[Importer] Subtitles missing or unverified, invoking dedicated subtitle locator...");
        const subs = await findSubtitlesForWork(parsedData.titleEn || url, parsedData.year || (/* @__PURE__ */ new Date()).getFullYear(), parsedData.type || "movie");
        if (!parsedData.subtitlesUrlAr) parsedData.subtitlesUrlAr = subs.ar;
        if (!parsedData.subtitlesUrlEn) parsedData.subtitlesUrlEn = subs.en;
      } catch (subErr) {
        console.warn("[Importer] Fallback subtitles lookup failed:", subErr);
      }
    }
    const tempMovieId = parsedData.id || `movie_${Date.now()}`;
    parsedData.id = tempMovieId;
    parsedData.subtitlesUrlAr = getValidSubtitleUrl(parsedData.subtitlesUrlAr, tempMovieId, "ar", void 0, void 0, parsedData);
    parsedData.subtitlesUrlEn = getValidSubtitleUrl(parsedData.subtitlesUrlEn, tempMovieId, "en", void 0, void 0, parsedData);
    if (parsedData.type === "series" && parsedData.seasons) {
      for (const season of parsedData.seasons) {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          for (const episode of season.episodes) {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;
            if (episode.subtitlesUrlAr && (episode.subtitlesUrlAr.startsWith("http://") || episode.subtitlesUrlAr.startsWith("https://"))) {
              const isValid = await verifySubtitleUrl(episode.subtitlesUrlAr, "ar");
              if (!isValid) {
                console.warn(`[Importer] Cleared unverified Arabic episode subtitle: ${episode.subtitlesUrlAr}`);
                episode.subtitlesUrlAr = "";
              }
            }
            if (episode.subtitlesUrlEn && (episode.subtitlesUrlEn.startsWith("http://") || episode.subtitlesUrlEn.startsWith("https://"))) {
              const isValid = await verifySubtitleUrl(episode.subtitlesUrlEn, "en");
              if (!isValid) {
                console.warn(`[Importer] Cleared unverified English episode subtitle: ${episode.subtitlesUrlEn}`);
                episode.subtitlesUrlEn = "";
              }
            }
            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, tempMovieId, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, tempMovieId, "en", sId, eId, episode);
          }
        }
      }
    }
    parsedData.poster = await verifyAndCorrectImageUrl(parsedData.poster, parsedData.titleEn || parsedData.titleAr, false, parsedData.genres);
    parsedData.backdrop = await verifyAndCorrectImageUrl(parsedData.backdrop, parsedData.titleEn || parsedData.titleAr, true, parsedData.genres);
    if (parsedData.director) {
      parsedData.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedData.director, parsedData.directorPhotoUrl);
    }
    if (parsedData.writer) {
      parsedData.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedData.writer, parsedData.writerPhotoUrl);
    }
    if (parsedData.castMembers && Array.isArray(parsedData.castMembers)) {
      for (const cast of parsedData.castMembers) {
        cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
      }
    }
    if (parsedData.type === "series" && parsedData.seasons && parsedData.seasons.length > 0) {
      const flatServers = [];
      parsedData.seasons.forEach((season) => {
        if (season.episodes && season.episodes.length > 0) {
          season.episodes.forEach((episode) => {
            const epNum = episode.number || 1;
            const epTitleAr = episode.titleAr || `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum}`;
            const epUrl = episode.servers && episode.servers[0]?.url || episode.url || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
            flatServers.push({
              name: `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum} - ${epTitleAr}`,
              url: epUrl
            });
          });
        }
      });
      if (flatServers.length > 0) {
        parsedData.servers = flatServers;
      }
    }
    if (!parsedData.logoUrl && (url || parsedData.titleEn || parsedData.titleAr)) {
      try {
        const tmdbScrap = await scrapeTMDBMetadata(url || parsedData.titleEn || parsedData.titleAr).catch(() => null);
        if (tmdbScrap && tmdbScrap.logoUrl) {
          parsedData.logoUrl = tmdbScrap.logoUrl;
          console.log("[Importer] Successfully fetched TMDB logo PNG for item:", parsedData.logoUrl);
        }
      } catch (lErr) {
      }
    }
    console.log("[Importer] Metadata Extracted, Verified and Formatted Successfully!");
    res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("[Importer] Gemini extraction failed. Falling back to robust TMDB scraper... Reason:", error.message || error);
    handleGeminiError(error, "import-url");
    try {
      const scrapedData = await scrapeTMDBMetadata(url);
      if (scrapedData && scrapedData.titleEn && !scrapedData.poster?.includes("images.unsplash.com")) {
        console.log("[Importer] Successfully scraped movie/series from TMDB as fallback!");
        return res.json({ success: true, data: scrapedData });
      }
    } catch (scrapeErr) {
      console.error("[Importer] TMDB scraper fallback also failed:", scrapeErr);
    }
    return res.status(400).json({ error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0641\u064A\u0644\u0645 \u0623\u0648 \u0645\u0633\u0644\u0633\u0644 \u062D\u0642\u064A\u0642\u064A \u0628\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u0623\u0648 \u0627\u0644\u0631\u0627\u0628\u0637 \u0639\u0644\u0649 TMDB. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0643\u062A\u0627\u0628\u0629 \u0627\u0644\u0627\u0633\u0645 \u0628\u062F\u0642\u0629 \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0627\u0645 \u0631\u0627\u0628\u0637 TMDB \u0645\u0628\u0627\u0634\u0631." });
  }
});
app.post("/api/admin/import-season", async (req, res) => {
  const { seriesTitle, seasonNumber, url } = req.body;
  const targetQuery = url || seriesTitle;
  if (!targetQuery) {
    return res.status(400).json({ error: "Missing required parameters: seriesTitle or url" });
  }
  const sNum = parseInt(seasonNumber, 10) || 1;
  try {
    console.log(`[Season Importer] Importing Season ${sNum} for query: "${targetQuery}"...`);
    const scrapedData = await scrapeTMDBMetadata(targetQuery);
    if (!scrapedData) {
      throw new Error("Could not find series metadata on TMDB");
    }
    let seasonObj = scrapedData.seasons?.find((s) => s.number === sNum);
    if (!seasonObj && scrapedData.id) {
      const tmdbIdMatch = scrapedData.id.match(/\d+/);
      if (tmdbIdMatch) {
        const tmdbId = tmdbIdMatch[0];
        const scrapedSeasons = await fetchTMDBSeriesSeasons(tmdbId, scrapedData.titleEn, scrapedData.titleAr, scrapedData.backdrop, scrapedData.rating || 8);
        seasonObj = scrapedSeasons?.find((s) => s.number === sNum);
      }
    }
    if (!seasonObj) {
      const sId = `s${sNum}_${Date.now()}`;
      seasonObj = {
        id: sId,
        number: sNum,
        titleAr: `\u0627\u0644\u0645\u0648\u0633\u0645 ${sNum}`,
        titleEn: `Season ${sNum}`,
        poster: scrapedData.poster || scrapedData.backdrop,
        backdrop: scrapedData.backdrop,
        year: scrapedData.year || (/* @__PURE__ */ new Date()).getFullYear(),
        storyAr: `\u062A\u0641\u0627\u0635\u064A\u0644 \u0648\u0623\u062D\u062F\u0627\u062B \u0627\u0644\u0645\u0648\u0633\u0645 ${sNum} \u0645\u0646 \u0645\u0633\u0644\u0633\u0644 ${scrapedData.titleAr}`,
        storyEn: `Details and plot of Season ${sNum} of ${scrapedData.titleEn}`,
        episodes: Array.from({ length: 10 }).map((_, i) => {
          const epNum = i + 1;
          const epId = `s${sNum}_e${epNum}_${Date.now()}`;
          return {
            id: epId,
            number: epNum,
            titleAr: `\u0627\u0644\u062D\u0644\u0642\u0629 ${epNum}`,
            titleEn: `Episode ${epNum}`,
            duration: "45m",
            storyAr: `\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062D\u0644\u0642\u0629 ${epNum} \u0645\u0646 \u0627\u0644\u0645\u0648\u0633\u0645 ${sNum} \u0644\u0645\u0633\u0644\u0633\u0644 ${scrapedData.titleAr}.`,
            storyEn: `Details of Episode ${epNum} of Season ${sNum} of ${scrapedData.titleEn}.`,
            thumbnail: scrapedData.backdrop,
            servers: [{ name: "\u0633\u064A\u0631\u0641\u0631 \u0627\u0644\u0628\u062B \u0627\u0644\u0631\u0626\u064A\u0633\u064A", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }],
            subtitlesUrlAr: `/api/subtitles?movieId=${scrapedData.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
            subtitlesUrlEn: `/api/subtitles?movieId=${scrapedData.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
            rating: scrapedData.rating || 8
          };
        })
      };
    }
    return res.json({
      success: true,
      seriesTitleAr: scrapedData.titleAr,
      seriesTitleEn: scrapedData.titleEn,
      season: seasonObj
    });
  } catch (err) {
    console.error("[Season Importer] Failed to import season:", err.message || err);
    return res.status(400).json({ error: `\u0641\u0634\u0644 \u0627\u0633\u062A\u064A\u0631\u0627\u062F \u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0645\u0648\u0633\u0645: ${err.message || "\u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641"}` });
  }
});
app.get("/api/movies/search", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) {
    return res.json({ items: [] });
  }
  try {
    const publishedDatabase = moviesDatabase.filter(
      (m) => !isMovieDeleted(m.id, m.titleAr, m.titleEn) && m.isPublished !== false
    );
    const localResults = publishedDatabase.filter(
      (m) => m.titleAr.toLowerCase().includes(query.toLowerCase()) || m.titleEn.toLowerCase().includes(query.toLowerCase()) || m.genres.some((g) => g.includes(query))
    );
    let finalResults = expandSearchResultsWithCollections(localResults, publishedDatabase);
    if (ai && finalResults.length < 3) {
      const generatedMovie = await generateMovieWithGemini(query);
      if (generatedMovie) {
        if (!moviesDatabase.some((m) => m.titleEn.toLowerCase() === generatedMovie.titleEn.toLowerCase() || m.id === generatedMovie.id)) {
          moviesDatabase.push(generatedMovie);
        }
        finalResults = expandSearchResultsWithCollections([...localResults, generatedMovie], moviesDatabase);
      }
    }
    finalResults.forEach((movie) => {
      enrichMovieMetadata(movie);
    });
    res.json({ items: finalResults });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/movies/detail", async (req, res) => {
  const id = req.query.id;
  const found = moviesDatabase.find((m) => m.id === id);
  if (found) {
    enrichMovieMetadata(found);
    return res.json(found);
  }
  if (id && id.startsWith("gemini_") && ai) {
    const cleanId = id.replace("gemini_", "").replace(/_/g, " ");
    const generated = await generateMovieWithGemini(cleanId);
    if (generated) {
      generated.id = id;
      enrichMovieMetadata(generated);
      moviesDatabase.push(generated);
      return res.json(generated);
    }
  }
  res.status(404).json({ error: "Movie not found" });
});
async function startServer() {
  const UPLOADS_DIR = import_path2.default.join(process.cwd(), "uploads");
  if (!import_fs.default.existsSync(UPLOADS_DIR)) {
    import_fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use("/uploads", import_express.default.static(UPLOADS_DIR));
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path2.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path2.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
