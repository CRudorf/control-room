// "Since you looked": what changed on a work item's PRs since the user last opened it on the board, or that
// nothing did. The question it answers is the one the user asked agents most ("any other feedback?", "is it
// mergeable?"), so the card answers it and the agents' `item` lookup prints the same line.
import type { PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { load, save } from "./db";

/** What a PR looked like when the user looked. */
export type PrSeen = { head: string; feedback: string[]; threads: number; checks: string; merge: string; decision: string | null };
export type Seen = { at: string; prs: Record<string, PrSeen> };

const feedbackKeys = (p: PrRow) => [...(p.feedback ?? []).map((f) => f.url), ...(p.threads ?? []).map((t) => t.url)];

export function seenOf(it: WorkItem, at = new Date().toISOString()): Seen {
  return { at, prs: Object.fromEntries(it.prs.map((p) => [prRef(p), { head: p.head, feedback: feedbackKeys(p), threads: p.threads?.length ?? 0, checks: p.checks, merge: p.merge_state, decision: p.review_decision }])) };
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const day = (iso: string, now: Date) => (new Date(iso).toDateString() === now.toDateString() ? hhmm(iso) : `${new Date(iso).toLocaleDateString("en-US", { weekday: "short" })} ${hhmm(iso)}`);
const failing = (c: string) => c === "failure" || c === "error";

/** Whether a PR can merge on its own: its base is the trunk, not another open PR's branch. Pure. */
export function standalone(p: PrRow): string {
  if (p.stack) return `stacked on #${p.stack.number}${p.stack.behind ? " (behind it)" : ""}: merge that first`;
  if (!/^(main|master|develop|plan)$/.test(p.base)) return `based on ${p.base}, not the trunk`;
  return "stands alone";
}

/** One line: what changed since `seen`, or that nothing did. Pure. */
export function sinceLine(it: WorkItem, seen: Seen | null, now = new Date()): string | null {
  if (!seen || !it.prs.length) return null;
  const out: string[] = [];
  for (const p of it.prs) {
    const was = seen.prs[prRef(p)];
    const at = `#${p.number}`;
    if (!was) { out.push(`${at} new`); continue; }
    const fresh = feedbackKeys(p).filter((k) => !was.feedback.includes(k));
    const bots = fresh.filter((k) => [...(p.feedback ?? []), ...(p.threads ?? [])].some((f) => f.url === k && f.bot)).length;
    if (fresh.length) out.push(`${fresh.length} new thread${fresh.length > 1 ? "s" : ""} on ${at}${bots ? ` (${bots === fresh.length ? "bot" : `${bots} bot`})` : ""}`);
    if (p.head !== was.head) out.push(`${p.role === "requested" ? `${p.author} pushed` : "pushed"} to ${at}`);
    if (p.checks !== was.checks && p.checks !== "pending") out.push(`CI ${failing(p.checks) ? "failing" : p.checks === "success" ? "green" : p.checks} on ${at}`);
    if (p.merge_state === "DIRTY" && was.merge !== "DIRTY") out.push(`conflicts on ${at}`);
    if (p.review_decision !== was.decision && p.review_decision) out.push(`${p.review_decision.toLowerCase().replace("_", " ")} on ${at}`);
  }
  return out.length ? `since ${day(seen.at, now)}: ${out.join(", ")}` : `nothing new since ${day(seen.at, now)}`;
}

let seen: Record<string, Seen> = load<Record<string, Seen>>("seen") ?? {};

/** The user looked at a work item: what it is now becomes the baseline. */
export function markSeen(it: WorkItem) {
  seen = { ...seen, [it.id]: seenOf(it) };
  // Items that left the board long ago drop out.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  seen = Object.fromEntries(Object.entries(seen).filter(([, s]) => s.at >= cutoff));
  save("seen", seen);
}

export function withSince(it: WorkItem): WorkItem {
  const line = sinceLine(it, seen[it.id] ?? null);
  return line ? { ...it, since: line } : it;
}
