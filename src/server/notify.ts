// Notification rules: notify only when the ball comes back. Pure; the caller sends and persists.
import type { PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";

/** One thing that happened on a work item. Its key is stable, so it never notifies twice. */
export type Signal = { key: string; text: string; loud: boolean; triggers: boolean; anyLane?: boolean };

export type Note = { title: string; body: string; url: string; loud: boolean; thread: string };

const MAX_PER_POLL = 3;
const short = (repo: string) => repo.split("/").pop()!;
const num = (p: PrRow) => `#${p.number}`;

export function signalsOf(it: WorkItem): Signal[] {
  const out: Signal[] = [];
  for (const a of it.agents) {
    const name = a.name ?? a.label;
    // An agent stopping hands the ball back whatever the PRs say, so these notify in any lane.
    if (a.status === "blocked") out.push({ key: `agent-blocked:${a.pane}@${a.seq}`, text: `agent ${name} is waiting on you`, loud: true, triggers: true, anyLane: true });
    const finished = a.status === "done" ? a.finishedSeq ?? a.seq : a.status === "idle" ? a.finishedSeq : null;
    if (finished !== null) out.push({ key: `agent-done:${a.pane}@${finished}`, text: `agent ${name} finished`, loud: false, triggers: true, anyLane: true });
  }
  if (it.park?.woke) out.push({ key: `unpark:${it.id}@${it.park.setAt}`, text: `back from parked: ${it.park.woke}`, loud: false, triggers: true, anyLane: true });
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
 * start: that gets one summary instead. Returns the notes and the keys to remember.
 */
export function decide(items: WorkItem[], seen: Set<string> | null, base: string): { notes: Note[]; seen: Set<string> } {
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
    const fresh = current.get(it.id)!.filter((s) => !seen.has(s.key));
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
  return { notes, seen: next };
}
