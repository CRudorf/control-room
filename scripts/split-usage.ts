// One time: moves usage rows of another project's repos out of this project's database, into theirs.
// Usage: CR_PROJECT=<from> bun scripts/split-usage.ts <to project> <to state.db>. A row with an unknown folder stays.
import { Database } from "bun:sqlite";
import { basename } from "node:path";
import { DB_PATH } from "../src/server/config";
import { loadProjectMap, projectOf, repoOfDir } from "../src/server/repos";

const [to, toDb] = process.argv.slice(2);
if (!to || !toDb) throw new Error("usage: split-usage.ts <to project> <to state.db>");
const map = loadProjectMap();
const from = new Database(DB_PATH);
from.exec(`VACUUM INTO '${DB_PATH}.before-split-${Date.now()}'`);
from.exec(`ATTACH '${toDb.replace(/'/g, "''")}' AS dest`);
const remote = (top: string) => { const r = Bun.spawnSync(["git", "-C", top, "remote", "get-url", "origin"]); return r.exitCode === 0 ? r.stdout.toString() : null; };
const belongs = new Map<string, boolean>();
const dirs = from.query("SELECT DISTINCT dir FROM usage_turns").all() as { dir: string }[];
for (const { dir } of dirs) { const top = repoOfDir(dir); belongs.set(dir, !!top && projectOf(basename(top), remote(top), map) === to); }
const moving = dirs.filter((d) => belongs.get(d.dir)).map((d) => d.dir);
const cols = (from.query("PRAGMA table_info(usage_turns)").all() as { name: string }[]).map((c) => c.name).join(",");
let moved = 0;
from.transaction(() => {
  for (const dir of moving) {
    moved += from.query(`INSERT OR IGNORE INTO dest.usage_turns (${cols}) SELECT ${cols} FROM usage_turns WHERE dir = ?`).run(dir).changes;
    from.query("DELETE FROM usage_turns WHERE dir = ?").run(dir);
  }
})();
console.log(`moved ${moved} rows from ${moving.length} folders. ${from.query("SELECT count(*) c FROM usage_turns").get()!.c} stay.`);
