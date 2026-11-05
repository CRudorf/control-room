// Control room state (ADR 0002). Marks and excludes stay in prs.py's files.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DB_PATH, DEV, INSTALLED_STATE_DIR } from "./config";

// A dev server starts from a copy of the installed app's state.
if (DEV && !existsSync(DB_PATH) && existsSync(join(INSTALLED_STATE_DIR, "state.db")))
  copyFileSync(join(INSTALLED_STATE_DIR, "state.db"), DB_PATH);

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
// The table had an older name. An older build run against a newer database makes the old one again
// beside the new: its rows join the new table, then it goes.
migrateRenamed("gates", "dependencies", "ref, set_at, on_ref, step");

/** Moves a table to its new name, or folds the old one into the new when both exist. */
export function migrateRenamed(from: string, to: string, cols: string) {
  const has = (t: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (!has(from)) return;
  if (!has(to)) { db.exec(`ALTER TABLE ${from} RENAME TO ${to}`); return; }
  db.transaction(() => {
    db.exec(`INSERT OR IGNORE INTO ${to} (${cols}) SELECT ${cols} FROM ${from}`);
    db.exec(`DROP TABLE ${from}`);
  })();
}
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS parked (
    item TEXT PRIMARY KEY, set_at TEXT NOT NULL, until TEXT, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS holds (
    ref TEXT PRIMARY KEY, set_at TEXT NOT NULL, head TEXT NOT NULL, since TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS action_records (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, work_item TEXT, action TEXT NOT NULL,
    trigger TEXT, drafted TEXT, sent TEXT, result TEXT, dry_run INTEGER NOT NULL DEFAULT 0, detail TEXT);
  CREATE TABLE IF NOT EXISTS item_events (
    id INTEGER PRIMARY KEY, at TEXT NOT NULL, item TEXT, kind TEXT NOT NULL, lane TEXT, step TEXT, detail TEXT,
    dry_run INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS item_events_at ON item_events (at);
  CREATE TABLE IF NOT EXISTS dependencies (
    ref TEXT PRIMARY KEY, set_at TEXT NOT NULL, on_ref TEXT, step TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS efforts (item_key TEXT PRIMARY KEY, effort TEXT NOT NULL, set_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS moves (ref TEXT PRIMARY KEY, into_item TEXT, into_key TEXT, into_kind TEXT);
  CREATE TABLE IF NOT EXISTS finished (
    ref TEXT PRIMARY KEY, at TEXT NOT NULL, state TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
    repo TEXT NOT NULL, branch TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS finished_items (
    key TEXT PRIMARY KEY, at TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL, why TEXT NOT NULL, repos TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS product_events (
    ref TEXT PRIMARY KEY, at TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, by TEXT, text TEXT NOT NULL DEFAULT '',
    prs TEXT NOT NULL DEFAULT '[]', branch TEXT, agent_sessions TEXT NOT NULL DEFAULT '[]', dry_run INTEGER NOT NULL DEFAULT 0);
`);

const get = db.query<{ v: string }, [string]>("SELECT v FROM kv WHERE k = ?");
const put = db.query("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");

export function load<T>(k: string): T | null {
  const row = get.get(k);
  return row ? (JSON.parse(row.v) as T) : null;
}

export function save(k: string, v: unknown) {
  put.run(k, JSON.stringify(v));
}
