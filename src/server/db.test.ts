import { expect, test } from "bun:test";
import { db, migrateRenamed } from "./db";

const has = (t: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

test("an old table made again beside its new name folds into it instead of crashing the boot", () => {
  db.exec("CREATE TABLE IF NOT EXISTS old_t (ref TEXT PRIMARY KEY, v TEXT); CREATE TABLE IF NOT EXISTS new_t (ref TEXT PRIMARY KEY, v TEXT)");
  db.exec("INSERT OR REPLACE INTO new_t VALUES ('a', 'kept'); INSERT OR REPLACE INTO old_t VALUES ('a', 'old'), ('b', 'moved')");
  migrateRenamed("old_t", "new_t", "ref, v");
  expect(has("old_t")).toBe(false);
  expect(db.query("SELECT ref, v FROM new_t ORDER BY ref").all()).toEqual([{ ref: "a", v: "kept" }, { ref: "b", v: "moved" }]);
});

test("with only the old table, it's renamed", () => {
  db.exec("DROP TABLE IF EXISTS new_u; CREATE TABLE old_u (ref TEXT PRIMARY KEY)");
  migrateRenamed("old_u", "new_u", "ref");
  expect(has("old_u")).toBe(false);
  expect(has("new_u")).toBe(true);
});
