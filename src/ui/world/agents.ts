// Who is where in the town, and doing what: agents from the board's work items, the step each is on, the
// spot that step puts it at, and the quest givers for the items that need the user. Pure, so it's tested.
import type { AgentTask, WorkItem } from "../../shared/types";
import { taskOfLabel } from "../../shared/tasks";
import { minimapDots } from "../minimap";
import { ASKING, BURNING, CX, CZ, DUELS, PRAYING, SEATS, type Skill, type Spot, SPOTS } from "./map";

/** Each skill is a step of the work: where an agent stands says what step it's on. */
export const STEP: Record<Skill, string> = { smithing: "Building", crafting: "Fixing", mining: "Testing", fishing: "Reviewing", woodcutting: "Charting", construction: "Improving", cooking: "Grilling" };
export const VERB: Record<Skill, string> = { smithing: "Smithing at an anvil", crafting: "Crafting at the workshop", woodcutting: "Chopping a tree", fishing: "Fishing", mining: "Mining a rock", construction: "Building at the construction site", cooking: "Cooking on the grill" };
export const AREA_STEP: Record<string, string> = { Smithy: "Building", Mine: "Testing", "Riverbank north": "Reviewing", "Riverbank south": "Reviewing", Grove: "Charting", Inn: "Resting", Wilderness: "Self-reviews", "Construction site": "Improving", Cookout: "Grilling", Workshop: "Fixing", Chapel: "Waiting on review", Bonfire: "Spent" };

export type Townsfolk = {
  pane: string; label: string; status: string; item: string; itemKey: string; itemTitle: string; branch: string | null;
  skill: Skill; step: string; detail: string;
  /** What it is: a self-review, another helper, or the session that owns the work. */
  kind: "selfreview" | "helper" | "implementer";
  /** Who its PR is waiting on for a review; null when it isn't. */
  awaiting: string | null;
  /** Why its job is done, when it is: it goes to the Bonfire until it closes. */
  spent: string | null;
  /** Its PR, by ref and title. */
  pr: { ref: string; title: string } | null;
};
export type Mode = "skill" | "drink" | "ask" | "fight" | "pray" | "burn";

const prOf = (it: Pick<WorkItem, "prs">, branch: string | null) => {
  const p = it.prs.find((q) => q.branch === branch) ?? it.prs[0];
  return p ? { ref: `${p.repo.split("/").pop()}#${p.number}`, title: p.title } : null;
};

/** Whose review a PR waits on: someone's asked, it isn't approved, and nothing's left to answer. */
export function awaitingReview(it: Pick<WorkItem, "prs">, branch: string | null): string | null {
  const p = it.prs.find((q) => q.branch === branch) ?? it.prs[0];
  if (!p || p.draft || p.review_decision === "APPROVED" || !p.pending_reviewers.length || p.feedback?.length || p.state === "address") return null;
  return p.pending_reviewers.map((r) => r.replace(/^@/, "")).join(", ");
}
/** `foe`: who a fighter fights; the implementer attacks, the self-review defends. */
export type Placed = { a: Townsfolk; mode: Mode; skill: Skill | null; s: Spot; foe?: string; role?: "attack" | "defend" };

/** The step an agent is on, from what it is (its label's verb) and the state of its PR. */
/** What improving work is about, from the item it was started for. */
const IMPROVING: [RegExp, string][] = [[/^loop-/, "the weekly self-improvement loop"], [/^lesson-/, "making a lesson stick"], [/^arch-/, "the codebase's architecture"], [/^stop-check-/, "a Stop-check hook"]];

/** The step an agent is on: its task decides, and for building or fixing, the state of its PR. */
export function stepOf(task: AgentTask, it: Pick<WorkItem, "id" | "key" | "prs" | "stopChecks">, branch: string | null): { skill: Skill; detail: string } {
  const p = it.prs.find((q) => q.branch === branch) ?? it.prs[0], at = p ? `#${p.number}` : "";
  if (task === "review" || task === "selfreview") return { skill: "fishing", detail: `reviewing ${p ? `${p.repo.split("/").pop()}${at}` : "the change"}` };
  if (task === "verify") return { skill: "mining", detail: "checking the change in a browser" };
  if (task === "chart") return { skill: "woodcutting", detail: "charting the change" };
  if (task === "improve") return { skill: "construction", detail: `improving ${IMPROVING.find(([re]) => re.test(it.id))?.[1] ?? "how the work is done"}` };
  if (task === "grill") return { skill: "cooking", detail: `grilling a plan for ${it.key}` };
  // Fixing is crafting: conflicts, failing CI and review threads, for a fix agent or a builder on that step.
  const fb = p?.feedback?.length ?? 0;
  const fix = !p ? null : p.merge_state === "DIRTY" ? `resolving conflicts on ${at}` : p.checks === "failure" || p.checks === "error" ? `fixing CI on ${at}`
    : fb || p.state === "address" || p.state === "handed-off" ? `addressing ${fb || "the"} review thread${fb === 1 ? "" : "s"} on ${at}` : null;
  if (fix) return { skill: "crafting", detail: fix };
  if (task === "fix") return { skill: "crafting", detail: p ? `fixing ${at}` : "fixing the change" };
  if (it.stopChecks?.some((c) => c.running)) return { skill: "mining", detail: "running the local checks" };
  if (!p) return { skill: "smithing", detail: "building the change, no PR yet" };
  if (p.checks === "pending") return { skill: "mining", detail: `waiting on CI for ${at}` };
  if (p.draft) return { skill: "smithing", detail: `building ${at}, a draft` };
  return { skill: "smithing", detail: `polishing ${at}` };
}

const DEMO: [Skill, string][] = [["construction", "improving the weekly self-improvement loop"], ["cooking", "grilling a plan for ABC-1"], ["fishing", "addressing 2 review threads on #12"], ["woodcutting", "charting the change"], ["mining", "waiting on CI for #34"], ["crafting", "resolving conflicts on #56"], ["smithing", "building the change, no PR yet"], ["mining", "running the local checks"]];

/**
 * Every agent on the board, once, in a stable order. `demo`: a tick that puts most to work, a few in the
 * Inn and one waiting on the user, shuffling as it changes, so every part of the town can be seen.
 */
export function townsfolk(items: WorkItem[], demo: number | null = null): Townsfolk[] {
  const seen = new Map<string, Townsfolk>();
  for (const it of items) for (const a of it.agents) {
    if (seen.has(a.pane)) continue;
    const task = a.task ?? taskOfLabel(a.label), st = stepOf(task, it, a.branch);
    const kind = task === "selfreview" ? "selfreview" : task === "build" || task === "fix" ? "implementer" : "helper";
    seen.set(a.pane, { pane: a.pane, label: a.name ?? a.label, status: a.status, item: it.id, itemKey: it.key, itemTitle: it.title, branch: a.branch, skill: st.skill, step: STEP[st.skill], detail: st.detail, kind, awaiting: awaitingReview(it, a.branch), spent: a.spent?.reason ?? null, pr: prOf(it, a.branch) });
  }
  const out = [...seen.values()].sort((a, b) => a.pane.localeCompare(b.pane));
  if (demo === null) return out;
  return out.flatMap((a, i) => {
    const [skill, detail] = DEMO[(i + demo) % DEMO.length];
    // Every fifth a self-review of the one before; on alternate ticks its findings are taken and it's gone.
    if (i % 5 === 1) return (demo + i) % 2 ? [{ ...a, kind: "selfreview" as const, item: out[i - 1].item, itemKey: out[i - 1].itemKey, itemTitle: out[i - 1].itemTitle, status: "working", skill: "fishing" as Skill, step: STEP.fishing, detail: "reviewing the change" }] : [];
    return [{ ...a, kind: i % 5 === 0 ? "implementer" as const : a.kind, status: i % 7 === 6 ? "blocked" : (i + demo) % 5 === 0 ? "idle" : "working", skill, step: STEP[skill], detail }];
  });
}

/** Where every agent goes: a working one to a free spot of its step (or the next skill with room), one
 *  waiting on the user to the square, the rest to a seat in the Inn. */
export function place(folk: Townsfolk[]): Placed[] {
  const free = Object.fromEntries(Object.entries(SPOTS).map(([k, v]) => [k, [...v]])) as Record<Skill, Spot[]>;
  const order: Skill[] = ["smithing", "crafting", "woodcutting", "fishing", "mining", "construction", "cooking"];
  let seat = 0, ask = 0, ring = 0, pray = 0, burn = 0;
  // A self-review and its PR's own session fight in the Wilderness until the findings are taken.
  const fights = new Map<string, Required<Pick<Placed, "foe" | "role" | "s">>>();
  for (const r of folk) {
    if (r.kind !== "selfreview" || ring >= DUELS.length) continue;
    const imp = folk.find((x) => x.item === r.item && x.kind === "implementer" && !fights.has(x.pane));
    if (!imp) continue;
    const [cx, cz] = DUELS[ring++];
    fights.set(imp.pane, { foe: r.pane, role: "attack", s: { x: cx - 0.75, z: cz, face: Math.PI / 2, at: [cx + 0.75, cz], area: "Wilderness" } });
    fights.set(r.pane, { foe: imp.pane, role: "defend", s: { x: cx + 0.75, z: cz, face: -Math.PI / 2, at: [cx - 0.75, cz], area: "Wilderness" } });
  }
  return folk.map((a) => {
    const f = fights.get(a.pane);
    if (f) return { a, mode: "fight", skill: null, ...f };
    if (a.status === "working") {
      const skill = [a.skill, ...order].find((s) => free[s].length);
      if (skill) return { a, mode: "skill", skill, s: free[skill].shift()! };
    }
    if (a.status === "blocked") {
      const [x, z] = ASKING[ask % ASKING.length], lap = Math.floor(ask++ / ASKING.length) * 0.6;
      return { a, mode: "ask", skill: null, s: { x: x + lap, z: z + lap, face: Math.PI, at: [x, z - 1], area: "Square" } };
    }
    // Its job is done: it burns its logs at the Bonfire until it closes.
    if (a.spent && burn < BURNING.length) return { a, mode: "burn", skill: null, s: BURNING[burn++] };
    // Not working, and its PR is out for someone's review: it prays, while there's room before the altar.
    if (a.awaiting && pray < PRAYING.length) return { a, mode: "pray", skill: null, s: PRAYING[pray++] };
    const s = SEATS[seat % SEATS.length], lap = Math.floor(seat++ / SEATS.length) * 0.35;
    return { a, mode: "drink", skill: null, s: { ...s, x: s.x + lap, z: s.z - lap } };
  });
}

export type Giver = { id: string; key: string; title: string; why: string; lane: "mine" | "asked"; x: number; z: number };
// An item on the user's turn only because of its agents (one finished, one waiting on the user): the
// agent itself shows that, resting in the Inn or asking in the square, so the item is no quest giver.
const AGENT_REASON = /^agent \S+ (finished|is waiting on you)$/;
const onlyAgents = (it: WorkItem) => it.lane === "mine" && !!it.why && it.why.split(" · ").every((r) => AGENT_REASON.test(r));

/** The items that need the user, as quest givers round the fountain: nearer when more pressing. */
export function givers(items: WorkItem[]): Giver[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return minimapDots(items.filter((it) => !onlyAgents(it))).map((d) => {
    const it = byId.get(d.id)!, dx = d.x - 50, dy = d.y - 50, f = Math.hypot(dx, dy) / 44, a = Math.atan2(dy, dx), r = 2.6 + f * 3.4;
    return { id: d.id, key: it.key, title: it.title, why: it.why || it.title, lane: d.lane, x: CX + Math.cos(a) * r * 1.15, z: CZ + Math.sin(a) * r * 0.95 };
  });
}
