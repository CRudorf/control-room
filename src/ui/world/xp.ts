// Experience, for the Old School RS skin: real events on the board earn XP in the skill for that step of
// the work, and XP makes levels on the game's own curve. Counted whenever the skin is on, so work done
// with the World closed still counts; the World shows the drops, level-ups and fireworks.
import { useEffect, useRef } from "react";
import type { Snapshot } from "../../shared/types";

export const XP_SKILLS = ["Building", "Testing", "Reviewing", "Charting", "Shipping"] as const;
export type XpSkill = (typeof XP_SKILLS)[number];
export type Gain = { skill: XpSkill; xp: number; why: string; shipped?: boolean };
export type Xp = Record<XpSkill, number>;

/** The XP each level starts at: the game's curve, level 1 to 99. */
export const LEVEL_XP: number[] = (() => {
  const out = [0, 0];
  let pts = 0;
  for (let l = 1; l < 99; l++) { pts += Math.floor(l + 300 * 2 ** (l / 7)); out.push(Math.floor(pts / 4)); }
  return out;
})();
export const levelOf = (xp: number) => { let l = 1; while (l < 99 && xp >= LEVEL_XP[l + 1]) l++; return l; };

/** What the user earned between two board snapshots. */
export function gains(before: Snapshot, after: Snapshot): Gain[] {
  const out: Gain[] = [];
  const prs = (s: Snapshot) => new Map(s.items.flatMap((it) => it.prs.filter((p) => p.role === "mine").map((p) => [`${p.repo}#${p.number}`, p] as const)));
  const was = prs(before);
  for (const [ref, p] of prs(after)) {
    const b = was.get(ref), at = `${ref.split("/").pop()}`;
    if (!b) continue;
    if (b.checks === "pending" && p.checks === "success") out.push({ skill: "Testing", xp: 25, why: `CI passed on ${at}` });
    if (b.review_decision !== "APPROVED" && p.review_decision === "APPROVED") out.push({ skill: "Reviewing", xp: 40, why: `${at} approved` });
    const answered = (b.feedback?.length ?? 0) - (p.feedback?.length ?? 0);
    if (answered > 0) out.push({ skill: "Reviewing", xp: 10 * answered, why: `answered ${answered} thread${answered > 1 ? "s" : ""} on ${at}` });
  }
  const agents = (s: Snapshot) => new Map(s.items.flatMap((it) => it.agents.map((a) => [a.pane, { a, it }] as const)));
  const had = agents(before);
  for (const [pane, { a, it }] of agents(after)) {
    if (had.get(pane)?.a.status !== "working" || a.status !== "done") continue;
    out.push(/^chart\b/.test(a.label) ? { skill: "Charting", xp: 30, why: `${a.name ?? a.label} charted ${it.key}` } : { skill: "Building", xp: 30, why: `${a.name ?? a.label} finished on ${it.key}` });
  }
  const shippedBefore = new Set(before.finished.map((f) => f.key));
  for (const f of after.finished) {
    if (shippedBefore.has(f.key)) continue;
    const merged = f.prs.filter((p) => p.state === "merged").length;
    if (merged) out.push({ skill: "Shipping", xp: 100 * merged, why: `shipped ${f.key}`, shipped: true });
  }
  return out;
}

const KEY = "cr-xp";
export const readXp = (): Xp => {
  const zero = Object.fromEntries(XP_SKILLS.map((s) => [s, 0])) as Xp;
  try { return { ...zero, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return zero; }
};
/** Adds gains to the saved XP; resolves to the level-ups they caused. */
export function award(gs: Gain[]): { skill: XpSkill; level: number }[] {
  const xp = readXp(), ups: { skill: XpSkill; level: number }[] = [];
  for (const g of gs) {
    const was = levelOf(xp[g.skill]);
    xp[g.skill] += g.xp;
    const now = levelOf(xp[g.skill]);
    if (now > was) ups.push({ skill: g.skill, level: now });
  }
  try { localStorage.setItem(KEY, JSON.stringify(xp)); } catch {}
  return ups;
}

export type XpEvent = { gains: Gain[]; ups: { skill: XpSkill; level: number }[] };
export const XP_EVENT = "cr-xp";

/** Watches the board while `on`, awarding what each new snapshot earned and announcing it to the World. */
export function useXp(snap: Snapshot | null, on: boolean) {
  const last = useRef<Snapshot | null>(null);
  useEffect(() => {
    if (!on || !snap) { last.current = snap; return; }
    const before = last.current;
    last.current = snap;
    if (!before || before === snap) return;
    const gs = gains(before, snap);
    if (!gs.length) return;
    window.dispatchEvent(new CustomEvent<XpEvent>(XP_EVENT, { detail: { gains: gs, ups: award(gs) } }));
  }, [snap, on]);
}
