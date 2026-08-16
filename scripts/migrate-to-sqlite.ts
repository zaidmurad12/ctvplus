import fs from "fs";
import path from "path";
import {
  getDb,
  replaceAllMoviesInDb,
  saveConfigToDb,
  replaceDeletedIdsInDb,
  loadAllMoviesFromDb,
} from "../db.ts";

// One-time (but safely re-runnable) migration from the flat JSON files to cinemana.db.
// Re-running it is idempotent: it always reads the JSON files fresh and does a full
// delete-then-reinsert into SQLite via the exact same db.ts functions the server itself
// uses, so this exercises the real write path rather than a separate one-off script path.

const MOVIES_DB_PATH = path.join(process.cwd(), "movies_db.json");
const CONFIG_PATH = path.join(process.cwd(), "config.json");
const DELETED_IDS_PATH = path.join(process.cwd(), "deleted_ids.json");

function readJson(filePath: string, fallback: any): any {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`[migrate] Failed to parse ${filePath}:`, err);
    return fallback;
  }
}

function main() {
  getDb(); // ensures the schema exists before anything else touches it

  const movies = readJson(MOVIES_DB_PATH, []);
  const config = readJson(CONFIG_PATH, {
    customHeroId: null,
    customTrendingIds: [],
    customPromos: [],
    adsSettings: null,
  });
  const deleted = readJson(DELETED_IDS_PATH, { ids: [], titles: [] });

  if (!Array.isArray(movies)) {
    console.error("[migrate] movies_db.json did not contain an array — aborting, nothing written.");
    process.exitCode = 1;
    return;
  }

  replaceAllMoviesInDb(movies);
  saveConfigToDb(config);
  replaceDeletedIdsInDb(deleted.ids ?? [], deleted.titles ?? []);

  // Verification pass: row count + a full deep-equality check per record.
  const roundTripped = loadAllMoviesFromDb();
  console.log(`[migrate] source movies_db.json: ${movies.length} records`);
  console.log(`[migrate] cinemana.db movies table: ${roundTripped.length} records`);

  if (roundTripped.length !== movies.length) {
    console.error("[migrate] MISMATCH — row count does not match the source file.");
    process.exitCode = 1;
    return;
  }

  const bySourceId = new Map(movies.map((m: any) => [m.id, m]));
  let mismatches = 0;
  for (const m of roundTripped) {
    const src = bySourceId.get(m.id);
    if (!src || JSON.stringify(src) !== JSON.stringify(m)) {
      mismatches++;
      console.error(`[migrate]   mismatch on id=${m.id}`);
    }
  }

  if (mismatches === 0) {
    console.log("[migrate] Deep-equality check: OK — every record matches the source exactly.");
    console.log(`[migrate] config keys migrated: ${Object.keys(config).join(", ")}`);
    console.log(`[migrate] deleted ids migrated: ${(deleted.ids ?? []).length} ids, ${(deleted.titles ?? []).length} titles`);
    console.log("[migrate] Done.");
  } else {
    console.error(`[migrate] ${mismatches} record(s) did not match — see above.`);
    process.exitCode = 1;
  }
}

main();
