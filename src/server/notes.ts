// Decisions on a work item: what the user settled about it (in scope, out of scope, a name, a choice) so
// every session on the item starts with them, rather than living in one session's context until a /clear,
// a compaction or a handoff loses them. Added from the board, or by an agent with `bun run item <key> --note`.
import type { ItemNote, WorkItem } from "../shared/types";
import { db } from "./db";

db.exec(`CREATE TABLE IF NOT EXISTS item_notes (
  id INTEGER PRIMARY KEY, item TEXT NOT NULL, at TEXT NOT NULL, text TEXT NOT NULL, by TEXT NOT NULL DEFAULT 'user');
  CREATE INDEX IF NOT EXISTS item_notes_item ON item_notes (item);`);

const norm = (k: string) => k.trim().toLowerCase();

/** The decisions recorded on any of these keys (an item's id and key), oldest first. */
export function notesFor(keys: string[]): ItemNote[] {
  const ks = [...new Set(keys.map(norm).filter(Boolean))];
  if (!ks.length) return [];
  return db.query<ItemNote, string[]>(`SELECT id, item, at, text, by FROM item_notes WHERE item IN (${ks.map(() => "?").join(",")}) ORDER BY at, id`).all(...ks);
}

export function addNote(item: string, text: string, by = "user"): ItemNote & { fresh: boolean } {
  const t = text.replace(/\s+/g, " ").trim();
  if (!item.trim() || !t) throw new Error("a note needs an item and some text");
  if (t.length > 500) throw new Error("keep a note under 500 characters");
  // The same decision twice is one note.
  const dup = notesFor([item]).find((n) => n.text.toLowerCase() === t.toLowerCase());
  if (dup) return { ...dup, fresh: false };
  const at = new Date().toISOString();
  const id = Number(db.query("INSERT INTO item_notes (item, at, text, by) VALUES (?, ?, ?, ?)").run(norm(item), at, t, by).lastInsertRowid);
  return { id, item: norm(item), at, text: t, by, fresh: true };
}

/**
 * Who hears about a new decision: every session on the item that's already running, since its prompt
 * carried only the decisions made before it started. Not one blocked on a dialog (the text would answer
 * it), not one being closed, and not the session that recorded it (by its folder). Pure.
 */
export function decisionTells(it: WorkItem, note: Pick<ItemNote, "text">, fromCwd: string | null): { pane: string; text: string }[] {
  const from = fromCwd?.replace(/\/+$/, "") ?? null;
  return it.agents
    .filter((a) => a.status !== "blocked" && !a.spent && !(from && (a.cwd === from || from.startsWith(`${a.cwd}/`))))
    .map((a) => ({ pane: a.pane, text: `A decision was just recorded on work item ${it.key}: ${note.text}\nFollow it from now on and don't reopen it. If something you've already done goes against it, tell me before changing it.` }));
}

export function removeNote(id: number) {
  db.query("DELETE FROM item_notes WHERE id = ?").run(id);
}

/** Adds each item's notes. */
export function withNotes(it: WorkItem): WorkItem {
  const n = notesFor([it.id, it.key]);
  return n.length ? { ...it, notes: n } : it;
}

/** The lines a prompt carries: the decisions, and how to add one. Pure. */
export function notesPrompt(item: string, notes: ItemNote[], cmd: string): string {
  const head = notes.length ? `Decisions already made on this work item. Follow them and don't reopen them:\n${notes.map((n) => `- ${n.text}`).join("\n")}\n\n` : "";
  return `${head}When I settle something about this work item (a scope cut, "don't do X", a name, a choice between options), record it in one line so later sessions know: \`${cmd} ${item} --note "<the decision>"\`.`;
}
