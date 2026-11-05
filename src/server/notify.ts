// Notification rules: notify only when the ball comes back. Pure; the caller sends and persists.
import type { PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";

/** One thing that happened on a work item. Its key is stable, so it never notifies twice. */
export type Signal = { key: string; text: string; loud: boolean; triggers: boolean; anyLane?: boolean };

export type Note = { title: string; body: string; url: string; loud: boolean; thread: string };

const MAX_PER_POLL = 3;
const short = (repo: string) => repo.split("/").pop()!;
const num = (p: PrRow) => `#${p.number}`;

/** A turn that starts this soon after the agent's last finish is someone at its terminal replying. */
export const REPLY_MS = 10 * 60_000;
/** A restart this soon after the last announcement picks up where it left off. */
export const RESUME_MS = 60 * 60_000;

/**
 * Whether a turn starting at `now` answers the agent's finish at `lastFinish`. A turn the
 * control room started (the review loop, new feedback, a handoff into an open session) never does.
 */
export const answersFinish = (lastFinish: number | undefined, now: number, byBoard: boolean) =>
  !byBoard && lastFinish !== undefined && now - lastFinish < REPLY_MS;

/** A pane's last finish, and when its current or last turn started and whether that turn answers the finish. */
export type Turn = { finish?: number; start?: number; replied: boolean };
export const turnStarts = (t: Turn | undefined, now: number, byBoard: boolean): Turn =>
  ({ finish: t?.finish, start: now, replied: answersFinish(t?.finish, now, byBoard) });
/** A reply that set off long work isn't one the user waited for: only a quick turn's finish stays quiet. */
export const turnEnds = (t: Turn | undefined, now: number): Turn =>
  ({ finish: now, start: t?.start, replied: !!t?.replied && t.start !== undefined && now - t.start < REPLY_MS });

export type Announced = { at: number; keys: string[] };

/** What a start remembers as announced: the saved keys after a quick restart, else null for one summary. */
export const resume = (saved: Announced | null, now: number): Set<string> | null =>
  saved && now - saved.at < RESUME_MS ? new Set(saved.keys) : null;

export function signalsOf(it: WorkItem): Signal[] {
  const out: Signal[] = [];
  for (const a of it.agents) {
    const name = a.name ?? a.label;
    // An agent stopping hands the ball back whatever the PRs say, so these notify in any lane.
    if (a.status === "blocked") out.push({ key: `agent-blocked:${a.pane}@${a.seq}`, text: `agent ${name} is waiting on you`, loud: true, triggers: true, anyLane: true });
    const finished = a.status === "done" ? a.finishedSeq ?? a.seq : a.status === "idle" ? a.finishedSeq : null;
    // A finish in a back-and-forth the user is having with the agent is the reply they're waiting for, not news.
    if (finished !== null && !a.replied) out.push({ key: `agent-done:${a.pane}@${finished}`, text: `agent ${name} finished`, loud: false, triggers: true, anyLane: true });
  }
  if (it.park?.woke) out.push({ key: `unpark:${it.id}@${it.park.setAt}`, text: `back from parked: ${it.park.woke}`, loud: false, triggers: true, anyLane: true });
  if (it.commentWait?.woke) out.push({ key: `comment:${it.id}@${it.commentWait.setAt}:${it.commentWait.woke}`, text: it.commentWait.woke, loud: true, triggers: true, anyLane: true });
  for (const g of it.dependencies ?? []) if (g.opened) out.push({ key: `dependency:${g.ref}@${g.setAt}`, text: `unblocked: ${g.opened}`, loud: false, triggers: true, anyLane: true });
  // Waiting on the author ended: the ball is back with the user.
  if (it.hold?.woke) out.push({ key: `woke:${it.hold.ref}@${it.hold.setAt}`, text: `${it.hold.woke} since you started waiting`, loud: true, triggers: true });
  for (const lv of it.loop ?? []) {
    const at = `#${lv.ref.split("#")[1]}`;
    if (lv.state === "stopped") out.push({ key: `loop-stop:${lv.ref}@${lv.why}`, text: `loop stopped on ${at}: ${lv.why}`, loud: true, triggers: true, anyLane: true });
    if (lv.replies?.length) out.push({ key: `loop-held:${lv.ref}@${lv.replies.map((r) => r.thread_id).join()}`, text: `${lv.replies.length} drafted repl${lv.replies.length === 1 ? "y" : "ies"} to send on ${at}`, loud: false, triggers: true, anyLane: true });
  }
  for (const p of it.prs) {
    if (p.role === "requested") {
      if (p.rereview) out.push({ key: `rereview:${prRef(p)}@${p.head}`, text: `${p.author} pushed since your review`, loud: false, triggers: true });
      else out.push({ key: `review:${prRef(p)}`, text: `review requested by ${p.author}${p.direct ? "" : " (team)"}`, loud: !!p.direct, triggers: true });
      continue;
    }
    for (const f of p.feedback ?? []) {
      const text = f.kind === "changes" ? `changes requested by ${f.who}` : `${f.who} ${f.kind === "thread" ? "commented" : "replied"} on ${num(p)}`;
      // Bot feedback rides along with the next notification on the work item.
      out.push({ key: `fb:${f.url}@${f.at}`, text, loud: f.kind === "changes", triggers: !f.bot });
    }
    if (p.checks === "failure" || p.checks === "error") out.push({ key: `ci:${prRef(p)}@${p.head}`, text: `CI failed on ${num(p)}`, loud: false, triggers: true });
    if (p.merge_queue?.state === "UNMERGEABLE") out.push({ key: `queue-fail:${prRef(p)}@${p.head}`, text: `merge queue can't merge ${num(p)}`, loud: true, triggers: true });
    if (p.merge_state === "DIRTY") out.push({ key: `conflict:${prRef(p)}@${p.head}`, text: `${num(p)} conflicts with ${p.base}`, loud: false, triggers: true });
    if (p.state === "merge" && p.can_merge === "yes") out.push({ key: `ready:${prRef(p)}@${p.head}`, text: `${num(p)} approved and green`, loud: false, triggers: true });
  }
  return out;
}

function titleOf(it: WorkItem): string {
  const lead = it.keyKind === "branch" ? it.repos[0] ?? it.key : it.key;
  const t = `${lead} · ${it.title}`;
  return t.length > 80 ? t.slice(0, 79) + "…" : t;
}

/**
 * What to announce, given what was announced before. `seen` is null on the first run after a
 * start that `resume` didn't pick up: that gets one summary instead. Returns the notes and the keys to remember.
 */
/** A second finish from the same agent this soon rides along with the next notification instead of making its own. */
export const QUIET_MS = 30 * 60_000;
export type Quiet = { now: number; lastDone: Record<string, number> };
const donePane = (key: string) => (key.startsWith("agent-done:") ? key.slice(11).split("@")[0] : null);

export function decide(items: WorkItem[], seen: Set<string> | null, base: string, quiet?: Quiet): { notes: Note[]; seen: Set<string>; lastDone?: Record<string, number> } {
  // Parked items never notify, agents and all; their wake does.
  const current = new Map<string, Signal[]>(items.map((it) => [it.id, it.lane === "parked" ? [] : signalsOf(it)]));
  const allKeys = new Set([...current.values()].flat().map((s) => s.key));

  if (seen === null) {
    const mine = items.filter((i) => i.lane === "mine").length;
    const asked = items.filter((i) => i.lane === "asked").length;
    const notes = mine || asked
      ? [{ title: "Control room", body: [mine && `${mine} in My turn`, asked && `${asked} asked of you`].filter(Boolean).join(", "), url: base, loud: false, thread: "summary" }]
      : [];
    return { notes, seen: allKeys };
  }

  const candidates: { it: WorkItem; fresh: Signal[] }[] = [];
  const next = new Set([...seen].filter((k) => allKeys.has(k)));
  for (const it of items) {
    const fresh = current.get(it.id)!.filter((s) => !seen.has(s.key))
      // An agent that finished again within QUIET_MS of its last notification is no news on its own.
      .map((s) => { const pane = donePane(s.key); return pane && quiet && quiet.now - (quiet.lastDone[pane] ?? 0) < QUIET_MS ? { ...s, triggers: false } : s; });
    // Only the ball coming back counts: The user's turn, or something asked of him.
    if (!fresh.some((s) => s.triggers && (s.anyLane || it.lane !== "waiting"))) continue;
    candidates.push({ it, fresh });
  }
  candidates.sort((a, b) => Number(b.fresh.some((s) => s.loud)) - Number(a.fresh.some((s) => s.loud)) || b.it.urgency - a.it.urgency);

  const notes: Note[] = [];
  for (const { it, fresh } of candidates.slice(0, MAX_PER_POLL)) {
    notes.push({
      title: titleOf(it), body: fresh.map((s) => s.text).join("; "), loud: fresh.some((s) => s.loud),
      url: `${base}item/${it.id}`, thread: it.id,
    });
  }
  const more = candidates.length - MAX_PER_POLL;
  if (more > 0) notes.push({ title: "Control room", body: `+${more} more in My turn`, url: base, loud: false, thread: "summary" });
  // Everything on a candidate counts as announced, folded or not: a state never notifies twice.
  for (const { fresh } of candidates) for (const s of fresh) next.add(s.key);
  // Quiet finishes count as announced too, so they don't come back later on their own.
  for (const it of items) for (const s of current.get(it.id)!) if (donePane(s.key) && !seen.has(s.key) && !candidates.some((c) => c.it.id === it.id)) next.add(s.key);
  const lastDone = quiet ? { ...quiet.lastDone } : undefined;
  if (lastDone) {
    for (const { fresh } of candidates.slice(0, MAX_PER_POLL)) for (const s of fresh) { const pane = donePane(s.key); if (pane) lastDone[pane] = quiet!.now; }
    for (const k of Object.keys(lastDone)) if (quiet!.now - lastDone[k] > QUIET_MS) delete lastDone[k];
  }
  return { notes, seen: next, lastDone };
}
