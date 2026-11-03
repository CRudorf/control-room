// The minimap: work items that need the user, as dots on a round map in the header. The more pressing an
// item, the nearer the middle, where the user stands. Skins that want it turn it on (skins.ts).
import type { WorkItem } from "../shared/types";

export type Dot = { id: string; label: string; lane: "mine" | "asked"; x: number; y: number };

// Distance from the middle, as a share of the radius, by urgency: 3 is changes requested, conflicts or
// people's feedback to address; 2 is failing CI, bot threads, a re-request or a ready merge, and a review
// asked of the user directly; 1 is the rest.
const RING: Record<number, [number, number]> = { 3: [0.12, 0.34], 2: [0.36, 0.58], 1: [0.6, 0.8] };
const OUTER: [number, number] = [0.8, 0.88];

const hash = (s: string) => [...s].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Where each of the user's items goes, in percent of the map from its top left. Stable for an item. */
export function minimapDots(items: WorkItem[]): Dot[] {
  return items.flatMap((it) => {
    if (it.lane !== "mine" && it.lane !== "asked") return [];
    const [lo, hi] = RING[Math.min(it.urgency, 3)] ?? OUTER;
    const a = ((hash(it.id) % 3600) / 3600) * 2 * Math.PI;
    const r = (lo + ((hash(`${it.id}:r`) % 1000) / 1000) * (hi - lo)) * 50;
    return [{ id: it.id, label: `${it.key}: ${it.why || it.title}`, lane: it.lane, x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r }];
  });
}

export function Minimap({ items, sel, onPick }: { items: WorkItem[]; sel: string | null; onPick: (id: string) => void }) {
  const dots = minimapDots(items);
  return (
    <div className="minimap" aria-label="Minimap: your items, the most pressing nearest the middle">
      <div className="mm-map">
        {dots.map((d) => (
          <button key={d.id} className={`mm-dot ${d.lane} ${d.id === sel ? "sel" : ""}`} title={d.label} aria-label={d.label}
            style={{ left: `${d.x}%`, top: `${d.y}%` }} onClick={() => onPick(d.id)} />
        ))}
        <i className="mm-you" />
      </div>
      <i className="mm-compass">N</i>
    </div>
  );
}
