// The friction log: when work items arrive, change lane or Next step, and leave the board, plus
// what the user does in Next mode. The Metrics view and the weekly loop read it.
import type { WorkItem } from "../shared/types";
import { DEV } from "./config";
import { db, load, save } from "./db";

const insert = db.query(`INSERT INTO item_events (at, item, kind, lane, step, detail, dry_run) VALUES (?, ?, ?, ?, ?, ?, ${DEV ? 1 : 0})`);

type Place = { lane: string; step: string | null };
let last = load<Record<string, Place>>("places");
// A move waits here until it has held for HOLD_MS: an agent flipping between working and finished
// bounces an item between lanes within seconds, and those flaps aren't moves.
let pending: Record<string, Place & { since: string }> = load<Record<string, Place & { since: string }>>("places_pending") ?? {};
export const HOLD_MS = 60_000;

type Row = [at: string, item: string, kind: string, lane: string | null, step: string | null, detail: string | null];
const same = (a: Place, b: Place) => a.lane === b.lane && a.step === b.step;

/**
 * The rows to log, and the new committed and pending places, given the last ones. Pure. A move is logged
 * at the time it started once it has held HOLD_MS; one that reverts before then is dropped.
 */
export function placesStep(items: WorkItem[], last: Record<string, Place> | null, pending: Record<string, Place & { since: string }>, at: string) {
  const now: Record<string, Place> = Object.fromEntries(items.map((i) => [i.id, { lane: i.lane, step: i.next?.step ?? null }]));
  if (!last) return { rows: [] as Row[], last: now, pending: {} };
  const rows: Row[] = [];
  const kept: Record<string, Place> = {};
  const wait: Record<string, Place & { since: string }> = {};
  for (const [id, p] of Object.entries(now)) {
    const was = last[id];
    if (!was) { rows.push([at, id, "arrive", p.lane, p.step, null]); kept[id] = p; continue; }
    if (same(was, p)) { kept[id] = was; continue; }
    const pend = pending[id] && same(pending[id], p) ? pending[id] : { ...p, since: at };
    if (Date.parse(at) - Date.parse(pend.since) >= HOLD_MS) { rows.push([pend.since, id, "move", p.lane, p.step, JSON.stringify(was)]); kept[id] = p; }
    else { kept[id] = was; wait[id] = pend; }
  }
  for (const [id, was] of Object.entries(last)) if (!now[id]) rows.push([at, id, "leave", null, null, JSON.stringify(was)]);
  return { rows, last: kept, pending: wait };
}

/** Logs every change of place that held; the first call ever only sets the baseline. */
export function recordPlaces(items: WorkItem[], at = new Date().toISOString()) {
  const r = placesStep(items, last, pending, at);
  for (const row of r.rows) insert.run(...row);
  last = r.last;
  pending = r.pending;
  save("places", last);
  save("places_pending", pending);
}

const KINDS = new Set(["next-open", "next-close", "next-done", "next-skip"]);

/** Something the user did that only the page knows about. */
export function recordEvent(item: string | null, kind: string, step: string | null) {
  if (!KINDS.has(kind)) throw new Error(`unknown event ${kind}`);
  insert.run(new Date().toISOString(), item, kind, null, step, null);
}
