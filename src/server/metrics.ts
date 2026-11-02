// Output metrics: what the user's PRs did, week by week, and how smoothly work moved (friction).
// Pure: no I/O. history.ts fetches the PR facts; events.ts logs the friction events.
import type { Feature, Friction, Quality, Shipped, StageTimes, Week } from "../shared/types";
import { weekOf } from "../shared/week";
import { branchFamily, trackerKey, KNOWN_PROJECTS, errorKey } from "./workitems";

export { weekOf };

/** One PR of the user's, reduced to timestamped facts. */
export type PrFacts = {
  ref: string; repo: string; number: number; title: string; url: string; feature: string; branch?: string;
  created: string; merged: string | null; closed: string | null;
  /** Review threads and change requests from people and review bots, and people's comments. */
  feedback: { at: string; who: string; bot: boolean; kind: "thread" | "changes" | "comment" }[];
  /** Commits that got a human review: one per round of review. */
  rounds: number;
  /** The user's own non-merge commits. */
  commits: { oid: string; at: string }[];
  /** When it went up for review: its first ready-for-review, else when it opened. */
  ready?: string;
  /** People's reviews, the user's own left out. */
  reviews?: { who: string; at: string; state: string }[];
  /** Review requests: a person's login, or "team:<slug>". */
  asks?: { who: string; at: string }[];
  /** The user's commits whose CI failed. */
  ciFailed?: number;
  /** What it merged into, as what, and the files it changed: for watching it after the merge. */
  base?: string; mergeSha?: string | null; files?: string[];
  /** Lines added and removed. */
  size?: number;
};

const isBot = (a: any) => !a || a.__typename === "Bot" || /\[bot\]$|^copilot/i.test(a.login ?? "");

/** The work item a PR belongs to, the same way the board groups them: Jira, else Sentry, else branch family. */
export function featureOf(title: string, branch: string, repo: string): string {
  const projects = new Set(KNOWN_PROJECTS);
  return trackerKey(title) ?? trackerKey(branch, projects) ?? errorKey(title) ?? errorKey(branch) ?? `${repo.split("/").pop()}:${branchFamily(branch)}`;
}

/** A PR node from history.ts's search into facts; `me` is the user's login. */
export function factsOf(n: any, me: string): PrFacts {
  const repo = n.repository.nameWithOwner;
  const others = (a: any) => a && a.login !== me;
  const feedback: PrFacts["feedback"] = [];
  for (const t of n.reviewThreads.nodes) {
    const c = t.comments.nodes[0];
    if (c && others(c.author)) feedback.push({ at: c.createdAt, who: c.author.login, bot: isBot(c.author), kind: "thread" });
  }
  for (const r of n.reviews.nodes)
    if (r.state === "CHANGES_REQUESTED" && others(r.author)) feedback.push({ at: r.submittedAt, who: r.author.login, bot: isBot(r.author), kind: "changes" });
  // Bots' top-level comments are summaries and CI reports, not feedback; their review threads are.
  for (const c of n.comments.nodes)
    if (others(c.author) && !isBot(c.author)) feedback.push({ at: c.createdAt, who: c.author.login, bot: isBot(c.author), kind: "comment" });
  const reviewed = new Set(n.reviews.nodes.filter((r: any) => others(r.author) && !isBot(r.author) && r.commit).map((r: any) => r.commit.oid));
  const own = n.commits.nodes
    .map((x: any) => x.commit)
    .filter((c: any) => c.parents.totalCount < 2 && c.authors.nodes.some((a: any) => a.user?.login === me));
  const commits = own.map((c: any) => ({ oid: c.oid, at: c.committedDate }));
  const ciFailed = own.filter((c: any) => c.statusCheckRollup?.state === "FAILURE" || c.statusCheckRollup?.state === "ERROR").length;
  return {
    ref: `${repo}#${n.number}`, repo, number: n.number, title: n.title, url: n.url,
    feature: featureOf(n.title, n.headRefName, repo), branch: n.headRefName,
    created: n.createdAt, merged: n.mergedAt ?? null, closed: n.mergedAt ? null : n.closedAt ?? null,
    feedback, rounds: reviewed.size, commits,
    ready: n.timelineItems?.nodes.find((e: any) => e.__typename === "ReadyForReviewEvent")?.createdAt ?? n.createdAt,
    reviews: n.reviews.nodes.filter((r: any) => others(r.author) && !isBot(r.author) && r.submittedAt).map((r: any) => ({ who: r.author.login, at: r.submittedAt, state: r.state })),
    asks: (n.timelineItems?.nodes ?? []).filter((e: any) => e.__typename === "ReviewRequestedEvent" && e.requestedReviewer && !isBot(e.requestedReviewer))
      .map((e: any) => ({ who: e.requestedReviewer.login ?? `team:${e.requestedReviewer.slug}`, at: e.createdAt })),
    ciFailed, base: n.baseRefName, mergeSha: n.mergeCommit?.oid ?? null, files: (n.files?.nodes ?? []).map((f: any) => f.path),
    ...(typeof n.additions === "number" ? { size: n.additions + (n.deletions ?? 0) } : {}),
  };
}

/** Week-by-week output, oldest first. Activity counts in the week it happened; rounds and size in the week a PR merged. */
export function weekly(prs: PrFacts[], from: string): Week[] {
  const weeks = new Map<string, Week & { _r: Set<string>; _f: Set<string> }>();
  const at = (iso: string | null) => {
    if (!iso || iso < from) return null;
    const k = weekOf(iso);
    if (!weeks.has(k)) weeks.set(k, { week: k, opened: 0, merged: 0, closed: 0, feedback: 0, humanFeedback: 0, rounds: [], sizes: [], commits: 0, repos: [], features: [], _r: new Set(), _f: new Set() });
    return weeks.get(k)!;
  };
  const touch = (w: ReturnType<typeof at>, p: PrFacts) => { if (w) { w._r.add(p.repo.split("/").pop()!); w._f.add(p.feature); } };
  for (const p of prs) {
    let w;
    if ((w = at(p.created))) { w.opened++; touch(w, p); }
    if ((w = at(p.merged))) { w.merged++; w.rounds.push(p.rounds); if (p.size !== undefined) w.sizes.push(p.size); touch(w, p); }
    if ((w = at(p.closed))) { w.closed++; touch(w, p); }
    for (const f of p.feedback) if ((w = at(f.at))) { w.feedback++; if (!f.bot) w.humanFeedback++; }
    for (const c of p.commits) if ((w = at(c.at))) { w.commits++; touch(w, p); }
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
    .map(({ _r, _f, ...w }) => ({ ...w, repos: [..._r].sort(), features: [..._f].sort() }));
}

/** Every feature (work item) since `from`, most recently active first. */
export function features(prs: PrFacts[], from: string): Feature[] {
  const by = new Map<string, Feature>();
  for (const p of prs) {
    const times = [p.created, p.merged, p.closed, ...p.commits.map((c) => c.at)].filter((t): t is string => !!t && t >= from).sort();
    if (!times.length) continue;
    const f = by.get(p.feature) ?? { key: p.feature, repos: [], prs: 0, merged: 0, commits: 0, first: times[0], last: times[0] };
    const repo = p.repo.split("/").pop()!;
    if (!f.repos.includes(repo)) f.repos.push(repo);
    f.prs++;
    if (p.merged) f.merged++;
    f.commits += p.commits.filter((c) => c.at >= from).length;
    if (times[0] < f.first) f.first = times[0];
    if (times.at(-1)! > f.last) f.last = times.at(-1)!;
    by.set(p.feature, f);
  }
  return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export type Event = { at: string; item: string | null; kind: string; lane: string | null; step: string | null; detail: string | null };

/** Week-by-week friction from the event log, oldest first. */
export function friction(events: Event[], from: string): Friction[] {
  const weeks = new Map<string, Friction>();
  const at = (iso: string) => {
    const k = weekOf(iso);
    if (!weeks.has(k)) weeks.set(k, { week: k, myTurnHours: [], nextDone: 0, nextSkipped: 0, nudges: 0 });
    return weeks.get(k)!;
  };
  const mineSince = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.kind === "arrive" || e.kind === "move" || e.kind === "leave") {
      const started = e.item && mineSince.get(e.item);
      if (started && e.lane !== "mine") {
        if (e.at >= from) at(e.at).myTurnHours.push((Date.parse(e.at) - Date.parse(started)) / 3_600_000);
        mineSince.delete(e.item!);
      } else if (e.item && e.lane === "mine" && !started) mineSince.set(e.item, e.at);
      continue;
    }
    if (e.at < from) continue;
    if (e.kind === "next-done") { at(e.at).nextDone++; if (e.step === "nudge") at(e.at).nudges++; }
    else if (e.kind === "next-skip") at(e.at).nextSkipped++;
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

const HISTORY_FRESH_MS = 86_400_000;

/** Why the PR history can't be reported on yet, or null when it synced within a day of `now`. */
export function historyNotReady(syncedAt: string | null, now = Date.now()): string | null {
  if (!syncedAt) return "PR history hasn't synced yet";
  if (now - Date.parse(syncedAt) > HISTORY_FRESH_MS) return `PR history last synced ${syncedAt}`;
  return null;
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const hours = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 3_600_000);

/**
 * Where a merged PR's time went, median hours per stage over the PRs merged since `from`: coding (first
 * commit to ready), waiting for the first person's review, in review (first review to approval), and
 * approval to merge. Per reviewer: how long a request to them took to answer, and what's unanswered now.
 */
export function stageTimes(prs: PrFacts[], from: string, now = Date.now()): StageTimes {
  const st = { coding: [] as number[], waitFirst: [] as number[], inReview: [] as number[], toMerge: [] as number[], total: [] as number[] };
  const merged = prs.filter((p) => p.merged && p.merged >= from && p.reviews);
  for (const p of merged) {
    const ready = p.ready ?? p.created;
    const first = p.commits.map((c) => c.at).sort()[0];
    if (first && first < ready) st.coding.push(hours(first, ready));
    const after = (p.reviews ?? []).filter((r) => r.at >= ready).sort((a, b) => a.at.localeCompare(b.at));
    const firstReview = after[0]?.at;
    const approved = after.find((r) => r.state === "APPROVED")?.at;
    if (firstReview) st.waitFirst.push(hours(ready, firstReview));
    // Most PRs are approved on their first review; this stage is about the ones that weren't.
    if (firstReview && approved && approved > firstReview) st.inReview.push(hours(firstReview, approved));
    st.toMerge.push(hours(approved ?? firstReview ?? ready, p.merged!));
    st.total.push(hours(first && first < ready ? first : ready, p.merged!));
  }
  const by = new Map<string, { waits: number[]; asks: number; open: number }>();
  const waiting: StageTimes["waiting"] = [];
  for (const p of prs) {
    const open = !p.merged && !p.closed;
    for (const a of p.asks ?? []) {
      if (a.at < from && !open) continue;
      const team = a.who.startsWith("team:");
      const answer = (p.reviews ?? []).filter((r) => r.at >= a.at && (team || r.who === a.who)).sort((x, y) => x.at.localeCompare(y.at))[0];
      if (!answer && !open) continue; // closed without an answer: nothing to wait on any more
      const e = by.get(a.who) ?? { waits: [], asks: 0, open: 0 };
      e.asks++;
      if (answer) e.waits.push(hours(a.at, answer.at));
      else { e.open++; waiting.push({ ref: p.ref, url: p.url, title: p.title, who: a.who, since: a.at, hours: hours(a.at, new Date(now).toISOString()) }); }
      by.set(a.who, e);
    }
  }
  const med = (k: keyof typeof st) => median(st[k]);
  return {
    from, prs: merged.length,
    medians: { coding: med("coding"), waitFirst: med("waitFirst"), inReview: med("inReview"), toMerge: med("toMerge"), total: med("total") },
    reviewers: [...by].map(([who, e]) => ({ who, asks: e.asks, answered: e.waits.length, median: median(e.waits), open: e.open }))
      .sort((a, b) => (b.median ?? -1) - (a.median ?? -1)),
    waiting: waiting.sort((a, b) => b.hours - a.hours),
  };
}

/** The action records quality() reads. */
export type QualityRecord = { at: string; action: string; sent: string | null; result: string | null };

/** Week by week: CI failures on merged PRs, agents and how often the user stepped in, the review loop, and shipped outcomes. */
export function quality(prs: PrFacts[], records: QualityRecord[], shipped: Pick<Shipped, "merged" | "state" | "verdict">[], from: string): Quality[] {
  const weeks = new Map<string, Quality>();
  const at = (iso: string | null) => {
    if (!iso || iso < from) return null;
    const k = weekOf(iso);
    if (!weeks.has(k)) weeks.set(k, { week: k, merged: 0, ciFailedPrs: 0, agents: 0, selfReviews: 0, touches: 0, loopRounds: 0, loopPushed: 0, loopStops: 0, shipped: { clean: 0, watching: 0, changed: 0, look: 0, broke: 0 }, confirmed: 0, dismissed: 0, productQuestions: 0, failedTesting: 0 });
    return weeks.get(k)!;
  };
  let w;
  for (const p of prs) if ((w = at(p.merged))) { w.merged++; if ((p.ciFailed ?? 0) > 0) w.ciFailedPrs++; }
  for (const r of records) {
    if (!(w = at(r.at)) || r.result?.startsWith("failed")) continue;
    if (r.action === "start-agent") { w.agents++; if (r.sent?.startsWith("selfreview ")) w.selfReviews++; }
    else if (r.action === "message-agent" || r.action === "type-agent" || r.action === "keys-agent") w.touches++;
    else if (r.action === "loop-stop") w.loopStops++;
    else if (r.action === "product-question") w.productQuestions = (w.productQuestions ?? 0) + 1;
    else if (r.action === "failed-testing") w.failedTesting = (w.failedTesting ?? 0) + 1;
    else if (r.action === "loop-report") {
      try { const rep = JSON.parse(r.result ?? ""); w.loopRounds++; if (rep.head) w.loopPushed++; } catch {} // "loop running" and the like aren't reports
    }
  }
  for (const s of shipped) if ((w = at(s.merged))) {
    w.shipped[s.state]++;
    if (s.verdict?.verdict === "caused") w.confirmed++;
    else if (s.verdict?.verdict === "not") w.dismissed++;
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/** Per repo, merged PRs watched and how many were reverted. Per repo and never blended, as DORA asks. */
export function revertsByRepo(ws: { ref: string; repo?: string | null; reverts: unknown[] }[]) {
  const out: Record<string, { merged: number; reverted: number }> = {};
  for (const w of ws) {
    const r = (out[w.repo ?? w.ref.split("#")[0]] ??= { merged: 0, reverted: 0 });
    r.merged++;
    if (w.reverts.length) r.reverted++;
  }
  return out;
}
