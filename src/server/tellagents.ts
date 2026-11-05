// Tells a PR's agent when new feedback arrives, so the user doesn't have to ask it. Messages are
// decided here, pure; the caller sends them and remembers what it told.
import type { Agent, Feedback, PrRow, ReviewDrafts, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";

export type Tell = { item: string; pane: string; keys: string[]; text: string };

export const feedbackKey = (f: Feedback) => `${f.url}@${f.at}`;

// People's feedback of any kind, and review bots' threads and findings; bots' top-level comments are summaries.
const counts = (f: Feedback) => !f.bot || f.kind === "thread" || f.kind === "review";

/** The line that tells a PR's owner about a self-review: how the hand-over is found again in its transcript. */
export const selfReviewLine = (d: ReviewDrafts) => `my self-review of ${d.pr} at ${d.sha.slice(0, 7)}`;

/** A self-review's findings on one commit: told once. */
export const selfReviewKey = (d: ReviewDrafts) => `self-review ${d.pr}@${d.sha}`;

// Helper sessions (reviews, charts, verification, one-thread checks and fixes) never own the PR.
const HELPER = /^(chart|verify|selfreview|review|check|fix)\b/;

const KIND: Record<Feedback["kind"], string> = { thread: "commented", changes: "requested changes", review: "reviewed", comment: "replied" };

/** The agent that owns a PR: one on its branch, else the work item's only agent. Never a helper, or one blocked on the user. */
export function ownerOf(p: PrRow, all: Agent[]): Agent | null {
  const agents = all.filter((a) => !HELPER.test(a.label));
  // The only session on the item is the owner only when it isn't on some other branch: findings for one
  // PR must never land in a session building another.
  const loose = (a: Agent) => !a.branch || /^(main|master|develop|plan|HEAD)$/.test(a.branch) || a.branch.startsWith("worktree-");
  const on = agents.find((a) => a.branch === p.branch || a.upstream === p.branch) ?? (agents.length === 1 && loose(agents[0]) ? agents[0] : null);
  return on && on.status !== "blocked" ? on : null;
}

/**
 * Feedback on the user's PRs not yet in `told`, one message per agent. `told` null: first run, tell nothing.
 * `skip`: PRs the review loop handles; it sends their agents its own prompt.
 * `reviews`: self-reviews of the user's PRs with findings open on the PR's head, by ref.
 */
export function tellsFor(items: WorkItem[], told: Set<string> | null, skip: Set<string> = new Set(), reviews: Map<string, ReviewDrafts> = new Map()): { tells: Tell[]; current: Set<string> } {
  const current = new Set<string>();
  const by = new Map<string, Tell & { lines: string[] }>();
  for (const it of items) {
    if (it.lane === "parked") continue;
    for (const p of it.prs) {
      if (p.role !== "mine") continue;
      const fresh = (p.feedback ?? []).filter(counts);
      for (const f of fresh) current.add(feedbackKey(f));
      const unseen = told && !skip.has(prRef(p)) ? fresh.filter((f) => !told.has(feedbackKey(f))) : [];
      // The loop works GitHub feedback, not self-reviews, and a self-review waits for an owner to tell.
      const d = reviews.get(prRef(p));
      if (d && told?.has(selfReviewKey(d))) current.add(selfReviewKey(d));
      const self = d && told && !told.has(selfReviewKey(d)) ? d : null;
      const a = unseen.length || self ? ownerOf(p, it.agents) : null;
      if (!a) continue;
      if (self) current.add(selfReviewKey(self));
      const t = by.get(a.pane) ?? { item: it.id, pane: a.pane, keys: [], text: "", lines: [] };
      for (const f of unseen) {
        t.keys.push(feedbackKey(f));
        t.lines.push(`- ${f.who} ${KIND[f.kind]} on ${prRef(p)}${f.where ? ` (${f.where})` : ""}: ${f.url}`);
      }
      if (self) {
        const open = self.findings.filter((f) => !f.dismissed);
        t.keys.push(selfReviewKey(self));
        t.lines.push(`- ${selfReviewLine(self)} found ${open.length}:`,
          ...open.map((f) => `  - ${f.rank}: ${f.title} (${f.path}:${f.line}). ${f.body}`));
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
