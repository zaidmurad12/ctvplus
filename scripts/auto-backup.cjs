// Periodic project backup: commits any changed file (movies_db.json, config.json,
// deleted_ids.json, uploads/*.srt, source code, etc.) to the local Git repo on an
// interval, so anything deleted or modified by accident — a bad admin edit, a bug in the
// healing/import pipeline, an interrupted write — can be recovered from Git history.
// cinemana.db itself is not tracked (it's binary and regenerable via `npm run db:migrate`
// from movies_db.json, which the SQLite layer keeps exporting on every save) — the JSON
// mirror committed here is the durable, diffable backup of the same data.
//
// Runs as its own long-lived process (see pm2 process "cinemana-backup"), independent of
// the main server, so a crash or restart of one never affects the other.

const { execSync } = require("child_process");

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PROJECT_ROOT = __dirname + "/..";

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: PROJECT_ROOT, encoding: "utf8" });
}

function runBackup() {
  const timestamp = new Date().toISOString();
  try {
    const status = git("status --porcelain");
    if (!status.trim()) {
      console.log(`[backup] ${timestamp} — no changes, skipping.`);
      return;
    }
    git("add -A");
    git(`commit -m "Automated backup: ${timestamp}"`);
    const changedFiles = status.trim().split("\n").length;
    console.log(`[backup] ${timestamp} — committed (${changedFiles} file(s) changed).`);
  } catch (err) {
    console.error(`[backup] ${timestamp} — error during automated backup:`, err.message || err);
  }
}

console.log(`[backup] Automated project backup started — checking for changes every ${INTERVAL_MS / 60000} minutes.`);
runBackup();
setInterval(runBackup, INTERVAL_MS);
