// The review loop: on the user's PRs, CI goes green and feedback gets worked by an agent, round after
// round, until a reviewer approves, unless the change is high risk or the loop runs out of road.
// Pure: decides steps and the loop's next state; reviewloop.ts does the I/O.
import type { Agent, HeldReply, LoopCheck, LoopView, PrRow, Reason, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { isFinished } from "./workitems";
import { describe, type Flag } from "./risk";

export const MAX_ROUNDS = 3;
export const MAX_NEW_AGENTS = 3;
const ROUND_TIMEOUT_MS = 3 * 3600_000;
// A new agent's tab takes a moment to show on the board.
const AGENT_GRACE_MS = 5 * 60_000;

/** What a round's agent writes when it stops. `checks`: each check it ran on the final code; missing from older agents. */
export type Report = { head: string | null; ask?: string | null; summary?: string; flake?: boolean; replies?: HeldReply[]; checks?: LoopCheck[] };

/** `started`: the loop opened a new tab for it, rather than asking an agent already on the branch. */
export type Round = { kind: "feedback" | "ci"; at: string; head: string; pane: string | null; agent: string | null; started: boolean; keys: string[]; changes: string[] };

/** The loop's memory of one PR. */
export type LoopPr = {
  off?: boolean;
  rounds: number;
  /** Feedback already worked, or there before the loop first saw the PR. */
  seen: string[];
  /** Heads whose failing CI was handed to an agent, or failing before the loop first saw the PR. */
  ciSeen: string[];
  reran: string[];
  updated: string[];
  rerequested: string[];
  /** Heads a round's agent pushed. */
  agentHeads: string[];
  /** People whose changes request a round already worked. */
  changesFrom: string[];
  /** High-risk files the user let the loop run past. */
  approved: string[];
  /** Parent heads already brought into a stacked PR. */
  restacked?: string[];
  round?: Round;
  stop?: { why: string; at: string; risk?: boolean };
  /** People's replies a round's agent drafted, waiting for the user to send. */
  held?: { head: string; replies: HeldReply[]; who: string[] };
  /** The checks the last report listed. */
  checks?: LoopCheck[];
};
export type Loops = Record<string, LoopPr>;

export type Step =
  | { do: "update" | "rerun"; ref: string; item: string }
  | { do: "restack"; ref: string; item: string; on: string; branch: string }
  | { do: "round"; ref: string; item: string; kind: Round["kind"]; pane: string | null }
  | { do: "rerequest"; ref: string; item: string; who: string[] };

export type Ctx = {
  now: number;
  /** Reports found for PRs with a round open. */
  reports: Map<string, Report>;
  risk: (p: PrRow) => Flag[] | undefined;
  /** Nothing saved yet: everything on the board now is the baseline. */
  first: boolean;
  lowMemory: boolean;
};

const fresh = (): LoopPr => ({ rounds: 0, seen: [], ciSeen: [], reran: [], updated: [], rerequested: [], agentHeads: [], changesFrom: [], approved: [] });
export const feedbackKey = (f: { url: string; at: string }) => `${f.url}@${f.at}`;
// People's feedback of any kind, and review bots' threads; bots' top-level comments are summaries.
const counts = (f: NonNullable<PrRow["feedback"]>[number]) => !f.bot || f.kind === "thread";
const failing = (p: PrRow) => p.checks === "failure" || p.checks === "error";
const behind = (p: PrRow) => p.merge_state === "BEHIND" || (p.behind_by ?? 0) > 0;
const num = (p: PrRow) => `${p.repo.split("/").pop()}#${p.number}`;
const name = (a: Agent) => a.name ?? a.label;

/** The PRs the loop looks after: The user's open, non-draft PRs that aren't blocked, parked or queued. */
export function looped(items: WorkItem[]): { it: WorkItem; p: PrRow }[] {
  const out: { it: WorkItem; p: PrRow }[] = [];
  for (const it of items) {
    if (it.lane === "parked" || it.keyKind === "review") continue;
    const blocked = new Set((it.dependencies ?? []).filter((g) => !g.opened).map((g) => g.ref));
    for (const p of it.prs) if (p.role === "mine" && !p.draft && !p.merge_queue && !blocked.has(prRef(p))) out.push({ it, p });
  }
  return out;
}

/** The loop's steps on the board as it is, and its state after them. */
export function decide(items: WorkItem[], loops: Loops, ctx: Ctx): { loops: Loops; steps: Step[] } {
  const next: Loops = structuredClone(loops);
  const steps: Step[] = [];
  let starts = Object.values(loops).filter((l) => l.round?.started && !l.stop).length;
  for (const { it, p } of looped(items)) {
    const ref = prRef(p);
    const fb = (p.feedback ?? []).filter(counts);
    if (!next[ref]) {
      next[ref] = fresh();
      if (ctx.first) {
        next[ref].seen = fb.map(feedbackKey);
        if (failing(p)) Object.assign(next[ref], { ciSeen: [p.head], reran: [p.head], updated: [p.head] });
        next[ref].rerequested = [p.head];
      }
    }
    const l = next[ref];
    const stop = (why: string, risk = false) => { l.stop = { why, at: new Date(ctx.now).toISOString(), ...(risk ? { risk } : {}) }; };

    // Replies the user sent, or answered on GitHub, leave the held drafts.
    if (l.held) {
      const open = new Set(fb.map((f) => f.thread_id).filter(Boolean));
      l.held.replies = l.held.replies.filter((r) => open.has(r.thread_id));
      if (!l.held.replies.length) delete l.held;
    }
    if (l.off || l.stop) continue;

    if (l.round) {
      const r = l.round;
      const report = ctx.reports.get(ref);
      const a = r.pane ? it.agents.find((x) => x.pane === r.pane) : undefined;
      if (report) {
        delete l.round;
        if (r.kind === "ci") l.ciSeen.push(r.head);
        if (report.head) { l.rounds++; l.agentHeads.push(report.head); }
        l.changesFrom.push(...r.changes);
        const replies = (report.replies ?? []).filter((x) => x.thread_id && x.body?.trim());
        if (replies.length) l.held = { head: report.head ?? p.head, replies, who: [...new Set([...replies.map((x) => x.who), ...r.changes])] };
        const checks = (Array.isArray(report.checks) ? report.checks : []).filter((c) => typeof c?.cmd === "string" && typeof c.exit === "number");
        if (checks.length) l.checks = checks; else delete l.checks;
        if (report.ask) stop(`agent needs a decision: ${report.ask}`);
        else if (report.flake) stop(`agent says CI flaked${report.summary ? `: ${report.summary}` : ""}`);
        // "Tests pass" isn't evidence: a pushed fix needs a check that came back 0.
        else if (report.head && report.head !== r.head && !checks.some((c) => c.exit === 0))
          stop(`agent pushed a fix with no passing check${checks.length ? `: ${checks.map((c) => `${c.cmd} exited ${c.exit}`).join(", ")}` : ""}`);
        // Feedback can be answered without code; CI that still fails can't.
        else if (!report.head && r.kind === "ci") stop(`agent couldn't fix CI${report.summary ? `: ${report.summary}` : ""}`);
      } else if (ctx.now - Date.parse(r.at) > ROUND_TIMEOUT_MS) stop("round ran over 3 hours without a report");
      else if (r.pane && !a && ctx.now - Date.parse(r.at) > AGENT_GRACE_MS) stop("the round's agent closed before it reported");
      else if (a && a.status !== "working" && a.status !== "blocked" && (isFinished(a) || a.status === "idle") && ctx.now - Date.parse(r.at) > 60_000)
        stop(`agent ${name(a)} stopped without a report`);
      continue;
    }

    // Someone else on it (the user, or an agent he's driving): leave it be.
    if (it.agents.some((a) => a.status === "working" || a.status === "blocked")) continue;
    // The PR's own session: on its branch, or in a tab named for it (a worktree's local branch can differ).
    const named = new RegExp(`\\b${p.repo.split("/").pop()!.replace(/[.-]/g, "\\$&")}#${p.number}\\b`);
    const owner = it.agents.find((a) => a.branch === p.branch || a.upstream === p.branch) ?? it.agents.find((a) => named.test(a.label)) ?? null;

    // Starts a round once the change is known not to be high risk.
    const round = (kind: Round["kind"], keys: string[], changes: string[]) => {
      const flags = ctx.risk(p);
      if (!flags) return; // still checking
      const unapproved = flags.filter((f) => !l.approved.includes(f.file));
      if (unapproved.length) return stop(`high risk: ${describe(unapproved)}`, true);
      if (l.rounds >= MAX_ROUNDS) return stop(`${MAX_ROUNDS} rounds and it still isn't through review`);
      if (!owner && (starts >= MAX_NEW_AGENTS || ctx.lowMemory)) return; // waits for room
      if (!owner) starts++;
      l.round = { kind, at: new Date(ctx.now).toISOString(), head: p.head, pane: owner?.pane ?? null, agent: owner ? name(owner) : null, started: !owner, keys, changes };
      if (kind === "feedback") l.seen.push(...keys);
      steps.push({ do: "round", ref, item: it.id, kind, pane: owner?.pane ?? null });
    };

    // A stacked PR takes its parent's latest before anything else: CI and reviewers should see it.
    if (p.stack?.behind && !(l.restacked ?? []).includes(p.stack.head)) {
      l.restacked = [...(l.restacked ?? []), p.stack.head];
      steps.push({ do: "restack", ref, item: it.id, on: p.stack.on, branch: p.stack.branch });
      continue;
    }

    if (failing(p)) {
      if (behind(p) && !l.updated.includes(p.head)) { l.updated.push(p.head); steps.push({ do: "update", ref, item: it.id }); continue; }
      if (!l.reran.includes(p.head)) { l.reran.push(p.head); steps.push({ do: "rerun", ref, item: it.id }); continue; }
      if (l.agentHeads.includes(p.head)) { stop("CI still fails after the loop's fix and a rerun"); continue; }
      if (!l.ciSeen.includes(p.head)) round("ci", [], []);
      continue;
    }
    if (p.checks === "pending") continue;

    const unseen = fb.filter((f) => !l.seen.includes(feedbackKey(f)));
    if (unseen.length) {
      const changes = [...new Set(unseen.filter((f) => f.kind === "changes").map((f) => f.who))];
      const again = changes.filter((w) => l.changesFrom.includes(w));
      if (again.length) { stop(`${again.join(", ")} requested changes again`); continue; }
      round("feedback", unseen.map(feedbackKey), changes);
      continue;
    }

    if (p.state === "re-request" && !l.held && (p.rerequest ?? []).length && !l.rerequested.includes(p.head)) {
      l.rerequested.push(p.head);
      steps.push({ do: "rerequest", ref, item: it.id, who: p.rerequest! });
    }
  }
  return { loops: next, steps };
}

/** How the loop stands on each PR it looks after, for the board. */
export function views(items: WorkItem[], loops: Loops): Map<string, LoopView> {
  const out = new Map<string, LoopView>();
  for (const { p } of looped(items)) {
    const ref = prRef(p), l = loops[ref];
    const base = { ref, rounds: l?.rounds ?? 0, ...(l?.checks?.length ? { checks: l.checks } : {}) };
    if (!l) out.set(ref, { ...base, state: "watching", why: "loop watching" });
    else if (l.off) out.set(ref, { ...base, state: "off", why: "loop off" });
    else if (l.stop) out.set(ref, { ...base, state: "stopped", why: l.stop.why, risk: !!l.stop.risk, ...(l.held ? { replies: l.held.replies, rerequest: l.held.who } : {}) });
    else if (l.round) out.set(ref, { ...base, state: "running", why: `loop round ${l.rounds + 1}: ${l.round.agent ? `agent ${l.round.agent}` : "an agent"} ${l.round.kind === "ci" ? "fixing CI" : "working the feedback"}` });
    else if (l.held) out.set(ref, { ...base, state: "held", why: `${l.held.replies.length} drafted repl${l.held.replies.length === 1 ? "y" : "ies"} to ${[...new Set(l.held.replies.map((r) => r.who))].join(", ")}`, replies: l.held.replies, rerequest: l.held.who });
    else out.set(ref, { ...base, state: "watching", why: l.rounds ? `loop watching, ${l.rounds} round${l.rounds === 1 ? "" : "s"} so far` : "loop watching" });
  }
  return out;
}

/** PRs with a round running: what they'd ask of the user is the agent's to do. */
export const running = (loops: Loops) => new Set(Object.entries(loops).filter(([, l]) => l.round && !l.stop && !l.off).map(([r]) => r));

/** PRs the loop handles, so the plain "new feedback" message to their agents is the loop's. */
export const owned = (loops: Loops) => new Set(Object.entries(loops).filter(([, l]) => !l.off && !l.stop).map(([r]) => r));

/** Puts the loop on the board: stops and drafted replies ask for the user; running rounds say so. */
export function applyLoop(items: WorkItem[], v: Map<string, LoopView>): WorkItem[] {
  return items.map((it) => {
    const mine = it.prs.map((p) => v.get(prRef(p))).filter((x): x is LoopView => !!x);
    if (!mine.length) return it;
    const out: WorkItem = { ...it, loop: mine };
    const reasons: Reason[] = [];
    for (const lv of mine) {
      const p = it.prs.find((x) => prRef(x) === lv.ref)!;
      if (lv.state === "stopped") reasons.push({ text: `loop stopped on ${num(p)}: ${lv.why}`, weight: 3, pr: lv.ref });
      if (lv.replies?.length) reasons.push({ text: `${lv.replies.length} drafted repl${lv.replies.length === 1 ? "y" : "ies"} to send on ${num(p)}`, weight: 2, pr: lv.ref });
    }
    const runningWhy = mine.filter((x) => x.state === "running").map((x) => x.why);
    if (!reasons.length) {
      if (runningWhy.length && out.lane === "waiting") out.why = [...runningWhy, out.why].join(" · ");
      return out;
    }
    const top = reasons[0];
    const p = it.prs.find((x) => prRef(x) === top.pr)!;
    const lv = mine.find((x) => x.ref === top.pr)!;
    out.lane = it.lane === "parked" ? it.lane : "mine";
    out.urgency = Math.max(it.lane === "mine" ? it.urgency : 0, ...reasons.map((r) => r.weight));
    out.why = [...reasons.map((r) => r.text), ...(it.lane === "mine" ? [it.why] : [])].join(" · ");
    if (lv.state === "stopped" && lv.risk) out.primary = { label: `Review the risky change on ${num(p)}`, url: `${p.url}/files`, pr: lv.ref };
    else if (lv.state === "stopped" && lv.why.startsWith("agent") && it.agents[0]) out.primary = { label: "Check the loop's agent", agent: it.agents[0].pane, pr: lv.ref };
    else if (lv.replies?.length) out.primary = { label: `Send ${lv.replies.length} drafted repl${lv.replies.length === 1 ? "y" : "ies"} on ${num(p)}`, act: "replies", pr: lv.ref };
    return out;
  });
}
