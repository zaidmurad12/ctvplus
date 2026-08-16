import Database from "better-sqlite3";
import path from "path";

// SQLite replaces movies_db.json/config.json/deleted_ids.json as the actual source of
// truth (see server.ts's saveMoviesDatabase/loadDatabase) — those three JSON files are
// still written after every save as a human-readable, git-trackable export, but they are
// no longer read from except by the one-time migration script (scripts/migrate-to-sqlite.ts).
//
// moviesDatabase in server.ts stays a plain in-memory array exactly as before; only the
// load/save calls underneath it change. Every function here therefore trades in loosely-
// typed plain objects (not the Movie type from src/types.ts, nor server.ts's own local
// duplicate of it) so this file has no import-cycle coupling to either.

const DB_PATH = path.join(process.cwd(), "cinemana.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
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

// ---- movies -----------------------------------------------------------

export function loadAllMoviesFromDb(): any[] {
  const rows = getDb().prepare("SELECT data FROM movies ORDER BY rowid").all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}

// Delete-then-reinsert inside one transaction, not INSERT OR REPLACE alone: moviesDatabase
// is mutated via .splice() on delete in server.ts, so REPLACE would never remove a row for
// an id no longer present in the array — it would only ever add/update. Wrapping both the
// delete and every insert in a single better-sqlite3 transaction is what makes this atomic:
// a crash or thrown error mid-write rolls the whole thing back instead of leaving a
// half-written table (the exact non-atomicity risk this migration exists to remove).
export function replaceAllMoviesInDb(movies: any[]): void {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO movies (id, type, title_ar, title_en, year, rating, is_published, updated_at, data)
    VALUES (@id, @type, @title_ar, @title_en, @year, @rating, @is_published, @updated_at, @data)
  `);
  const tx = db.transaction((rows: any[]) => {
    db.prepare("DELETE FROM movies").run();
    const now = new Date().toISOString();
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
        data: JSON.stringify(m),
      });
    }
  });
  tx(movies);
}

// ---- config -------------------------------------------------------------

const CONFIG_KEYS = ["customHeroId", "customTrendingIds", "customPromos", "adsSettings"] as const;

export function loadConfigFromDb(): {
  customHeroId: string | null;
  customTrendingIds: string[];
  customPromos: any[];
  adsSettings: any;
} {
  const rows = getDb().prepare("SELECT key, value FROM config").all() as { key: string; value: string }[];
  const byKey = new Map(rows.map(r => [r.key, r.value]));
  const parse = (key: string, fallback: any) => {
    const raw = byKey.get(key);
    if (raw === undefined) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  };
  return {
    customHeroId: parse("customHeroId", null),
    customTrendingIds: parse("customTrendingIds", []),
    customPromos: parse("customPromos", []),
    adsSettings: parse("adsSettings", null),
  };
}

export function saveConfigToDb(config: {
  customHeroId: string | null;
  customTrendingIds: string[];
  customPromos: any[];
  adsSettings: any;
}): void {
  const db = getDb();
  const upsertStmt = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
  const tx = db.transaction(() => {
    for (const key of CONFIG_KEYS) {
      upsertStmt.run(key, JSON.stringify((config as any)[key] ?? null));
    }
  });
  tx();
}

// ---- deleted ids ----------------------------------------------------------

export function loadDeletedIdsFromDb(): { ids: string[]; titles: string[] } {
  const rows = getDb().prepare("SELECT kind, value FROM deleted_ids").all() as { kind: string; value: string }[];
  const ids: string[] = [];
  const titles: string[] = [];
  for (const row of rows) {
    if (row.kind === "id") ids.push(row.value);
    else titles.push(row.value);
  }
  return { ids, titles };
}

export function replaceDeletedIdsInDb(ids: Iterable<string>, titles: Iterable<string>): void {
  const db = getDb();
  const insertStmt = db.prepare("INSERT OR IGNORE INTO deleted_ids (kind, value) VALUES (?, ?)");
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM deleted_ids").run();
    for (const id of ids) insertStmt.run("id", id);
    for (const title of titles) insertStmt.run("title", title);
  });
  tx();
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
