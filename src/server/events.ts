// The friction log: when work items arrive, change lane or Next step, and leave the board, plus
// what the user does in Next mode. The Metrics view and the weekly loop read it.
import type { WorkItem } from "../shared/types";
import { DEV } from "./config";
import { db, load, save } from "./db";

const insert = db.query(`INSERT INTO item_events (at, item, kind, lane, step, detail, dry_run) VALUES (?, ?, ?, ?, ?, ?, ${DEV ? 1 : 0})`);

type Place = { lane: string; step: string | null };
let last = load<Record<string, Place>>("places");

/** Logs every change of place since the last call; the first call ever only sets the baseline. */
export function recordPlaces(items: WorkItem[], at = new Date().toISOString()) {
  const now: Record<string, Place> = Object.fromEntries(items.map((i) => [i.id, { lane: i.lane, step: i.next?.step ?? null }]));
  if (last) {
    for (const [id, p] of Object.entries(now)) {
      const was = last[id];
      if (!was) insert.run(at, id, "arrive", p.lane, p.step, null);
      else if (was.lane !== p.lane || was.step !== p.step) insert.run(at, id, "move", p.lane, p.step, JSON.stringify(was));
    }
    for (const [id, was] of Object.entries(last)) if (!now[id]) insert.run(at, id, "leave", null, null, JSON.stringify(was));
  }
  last = now;
  save("places", now);
}

const KINDS = new Set(["next-open", "next-close", "next-done", "next-skip"]);

/** Something the user did that only the page knows about. */
export function recordEvent(item: string | null, kind: string, step: string | null) {
  if (!KINDS.has(kind)) throw new Error(`unknown event ${kind}`);
  insert.run(new Date().toISOString(), item, kind, null, step, null);
}
