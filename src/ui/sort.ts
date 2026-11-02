// Sorting the board by a column, within each group. Ascending puts what needs attention first: a red
// cell before a plain one before a green one before an empty one, more feedback first, latest action first.
import type { Cell, WorkItem } from "../shared/types";

export type SortCol = "item" | "fb" | "ci" | "rv" | "mg" | "ag" | "last";
export type Sort = { col: SortCol; dir: 1 | -1 } | null;

const TONE: Record<Cell["tone"], number> = { pen: 0, "": 1, ok: 2, dim: 3 };
const ts = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
const byCell = (c: Cell): [number, string] => [TONE[c.tone], c.text];

function key(it: WorkItem, col: SortCol): [number, string] {
  switch (col) {
    case "item": return [0, it.key.toLowerCase()];
    case "fb": return [-it.prs.reduce((n, p) => n + (p.feedback?.length ?? 0), 0), ""];
    case "last": return [it.last?.now ? -Infinity : -ts(it.last?.at), ""];
    default: return byCell(it.cells[col]);
  }
}

/** The items in the sort's order; equal ones keep the board's own order. No sort: unchanged. */
export function sortBy<T extends WorkItem>(items: T[], sort: Sort): T[] {
  if (!sort) return items;
  return items.map((it, i) => ({ it, i, k: key(it, sort.col) }))
    .sort((a, b) => sort.dir * (a.k[0] - b.k[0] || a.k[1].localeCompare(b.k[1])) || a.i - b.i)
    .map((x) => x.it);
}

/** A header click: this column ascending, then descending, then back to the board's order. */
export const nextSort = (cur: Sort, col: SortCol): Sort =>
  cur?.col !== col ? { col, dir: 1 } : cur.dir === 1 ? { col, dir: -1 } : null;
