// Tells a PR's agent when new feedback arrives, so the user doesn't have to ask it. Messages are
// decided here, pure; the caller sends them and remembers what it told.
import type { Agent, Feedback, PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";

export type Tell = { item: string; pane: string; keys: string[]; text: string };

export const feedbackKey = (f: Feedback) => `${f.url}@${f.at}`;

// People's feedback of any kind, and review bots' threads; bots' top-level comments are summaries.
const counts = (f: Feedback) => !f.bot || f.kind === "thread";

const KIND: Record<Feedback["kind"], string> = { thread: "commented", changes: "requested changes", review: "reviewed", comment: "replied" };

/** The agent that owns a PR: one on its branch, else the work item's only agent. Never one blocked on the user. */
function ownerOf(p: PrRow, agents: Agent[]): Agent | null {
  const on = agents.find((a) => a.branch === p.branch || a.upstream === p.branch) ?? (agents.length === 1 ? agents[0] : null);
  return on && on.status !== "blocked" ? on : null;
}

/**
 * Feedback on the user's PRs not yet in `told`, one message per agent. `told` null: first run, tell nothing.
 * `skip`: PRs the review loop handles; it sends their agents its own prompt.
 */
export function tellsFor(items: WorkItem[], told: Set<string> | null, skip: Set<string> = new Set()): { tells: Tell[]; current: Set<string> } {
  const current = new Set<string>();
  const by = new Map<string, Tell & { lines: string[] }>();
  for (const it of items) {
    if (it.lane === "parked") continue;
    for (const p of it.prs) {
      if (p.role !== "mine") continue;
      const fresh = (p.feedback ?? []).filter(counts);
      for (const f of fresh) current.add(feedbackKey(f));
      const unseen = told && !skip.has(prRef(p)) ? fresh.filter((f) => !told.has(feedbackKey(f))) : [];
      const a = unseen.length ? ownerOf(p, it.agents) : null;
      if (!a) continue;
      const t = by.get(a.pane) ?? { item: it.id, pane: a.pane, keys: [], text: "", lines: [] };
      for (const f of unseen) {
        t.keys.push(feedbackKey(f));
        t.lines.push(`- ${f.who} ${KIND[f.kind]} on ${prRef(p)}${f.where ? ` (${f.where})` : ""}: ${f.url}`);
      }
      by.set(a.pane, t);
    }
  }
  const tells = [...by.values()].map(({ lines, ...t }) => ({
    ...t,
    text: `New feedback came in:\n${lines.join("\n")}\nVerify each point against the code, then draft a response or fix. Don't post replies or push without asking me.`,
  }));
  return { tells, current };
}
