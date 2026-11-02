// Stale waits: The user's PRs sitting on a reviewer for STALE_WEEKDAYS weekdays, one nudge per
// reviewer covering all of theirs. Pure: no I/O.
import type { Nudge, PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";

export const STALE_WEEKDAYS = 2;

const ts = (s: string) => Date.parse(s) || 0;

/** Weekdays begun since `iso`, not counting its own day: Friday → Monday is 1, → Tuesday is 2. */
export function weekdaysSince(iso: string, now = Date.now()): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  let n = 0;
  for (d.setDate(d.getDate() + 1); d.getTime() <= now; d.setDate(d.getDate() + 1)) if (d.getDay() % 6) n++;
  return n;
}

// Teams have no one to message; bots don't read Slack.
const person = (who: string) => !who.startsWith("@") && !/\[bot\]$|^copilot/i.test(who);

/** When a reviewer last heard about this PR: it landed on them, or the user nudged them since. */
const since = (p: PrRow, who: string, nudged: Map<string, string>) => {
  const n = nudged.get(`${prRef(p)}|${who}`);
  const w = p.waiting_since ?? p.last_activity;
  return n && ts(n) > ts(w) ? n : w;
};

/** The Slack DM, in the user's voice: lowercase, short, the links do the explaining. */
export function nudgeText(prs: { url: string }[]): string {
  return prs.length === 1
    ? `could you take a look at this one when you get a chance? ${prs[0].url}`
    : `could you take a look at these when you get a chance?\n${prs.map((p) => p.url).join("\n")}`;
}

/** One nudge per reviewer holding any of the user's unparked PRs past the threshold; most PRs, then oldest, first. */
export function staleNudges(items: WorkItem[], nudged: Map<string, string>, now = Date.now()): Nudge[] {
  const by = new Map<string, Nudge["prs"]>();
  for (const it of items) {
    if (it.lane === "parked") continue;
    for (const p of it.prs) {
      if (p.role !== "mine" || p.draft || (p.state !== "waiting" && p.state !== "addressed")) continue;
      for (const who of p.pending_reviewers.filter(person)) {
        const s = since(p, who, nudged);
        if (weekdaysSince(s, now) < STALE_WEEKDAYS) continue;
        by.set(who, [...(by.get(who) ?? []), { ref: prRef(p), url: p.url, title: p.title, item: it.id, since: s }]);
      }
    }
  }
  return [...by.entries()]
    .map(([reviewer, prs]) => {
      prs.sort((a, b) => ts(a.since) - ts(b.since));
      return { reviewer, prs, text: nudgeText(prs) };
    })
    .sort((a, b) => b.prs.length - a.prs.length || ts(a.prs[0].since) - ts(b.prs[0].since));
}
