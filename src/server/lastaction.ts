// The last action on a work item, by anyone: a push or comment on its PRs, feedback (bots too), an
// agent starting or stopping, or something the user did through the control room. The board's Last column.
import type { LastAction, WorkItem } from "../shared/types";
import { db } from "./db";

const ts = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
const short = (repo: string) => repo.split("/").pop()!;

const AGENT_DID: Record<string, string> = { working: "started working", blocked: "asked you something", done: "finished", idle: "stopped", unknown: "changed" };

/** The newest action, or null when nothing has a time. A working agent is acting now. */
export function lastAction(it: Pick<WorkItem, "prs" | "agents">, mine: { at: string; action: string } | null = null, now = new Date().toISOString()): LastAction | null {
  const seen: LastAction[] = [];
  for (const p of it.prs) {
    const n = `${short(p.repo)}#${p.number}`;
    if (p.last_push) seen.push({ at: p.last_push, what: `push to ${n}` });
    if (p.last_activity && p.last_activity !== p.last_push) seen.push({ at: p.last_activity, what: `comment or review on ${n}` });
    for (const f of p.feedback ?? []) seen.push({ at: f.at, what: `${f.who} on ${n}` });
  }
  for (const a of it.agents) {
    // herdr numbers unnamed sessions; the tab label says more than "1".
    const name = a.name && !/^\d+$/.test(a.name) ? a.name : a.label;
    if (a.status === "working") seen.push({ at: now, what: `${name} is working`, now: true });
    else if (a.since) seen.push({ at: a.since, what: `${name} ${AGENT_DID[a.status] ?? "changed"}` });
  }
  if (mine) seen.push({ at: mine.at, what: `you: ${mine.action.replace(/-/g, " ")} (control room)` });
  return seen.filter((x) => ts(x.at)).sort((a, b) => Number(!!b.now) - Number(!!a.now) || ts(b.at) - ts(a.at))[0] ?? null;
}

/** The user's latest control room action on each work item. Dry runs and notifications (the control room telling the user) don't count. */
export function myLastActions(): Map<string, { at: string; action: string }> {
  const rows = db.query<{ work_item: string; at: string; action: string }, []>(
    `SELECT work_item, at, action FROM action_records r WHERE dry_run = 0 AND action != 'notify' AND work_item IS NOT NULL
     AND at = (SELECT MAX(at) FROM action_records WHERE work_item = r.work_item AND dry_run = 0 AND action != 'notify')`).all();
  return new Map(rows.map((r) => [r.work_item, { at: r.at, action: r.action }]));
}
