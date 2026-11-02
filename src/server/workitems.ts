// Groups PR rows into work items and decides each one's lane. Pure: no I/O past reading settings once.
import type { Agent, Cell, FinishedItem, Dependency, Hold, ItemBranch, Issue, Lane, Move, NextStep, Park, PrRow, Reason, Run, Suggested, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { SETTINGS, KNOWN_PROJECTS } from "./settings";
import { branchLine } from "../shared/branches";
import type { ParkState } from "./parkrules";
import { reachedLast, outcomeOf, acceptanceLane } from "./acceptance";

// Branch names are lowercase and full of words-with-numbers, so a branch only
// yields a Jira key for a project already seen in a title, or one in settings.
export { KNOWN_PROJECTS };

export { errorKey, trackerKey } from "./keys";
import { ERROR_ID, errorKey, trackerKey } from "./keys";

/** "ABC-616: remove x", "[ABC-996] fix(a): y", "fix(api): ABC-3-API-1V stop z" → the readable part. */
export function cleanTitle(title: string): string {
  return title
    .replace(ERROR_ID, "")
    .replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, "")
    .replace(/^[\s:[\]\-–—|]+/, "")
    .replace(/^\w+(\([^)]*\))?!?:\s*/, "")
    .replace(/^[\s:[\]\-–—|]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim() || title;
}

const ts = (s: string) => Date.parse(s) || 0;
const short = (repo: string) => repo.split("/").pop()!;
const num = (p: PrRow) => `${short(p.repo)}#${p.number}`;

/** Why a PR of the user's needs him now. Empty: the ball is elsewhere. */
export function needs(p: PrRow): Reason[] {
  const r: Reason[] = [];
  const at = num(p);
  const human = (p.feedback ?? []).filter((f) => !f.bot).length;
  const fb = p.feedback?.length ?? 0;
  if (p.state === "address") {
    const what = human ? `${fb} unanswered` : `${fb} bot thread${fb > 1 ? "s" : ""}`;
    r.push({ text: `${what} on ${at}`, weight: human ? 3 : 2, pr: prRef(p), handoff: "feedback" });
  }
  if (p.feedback?.some((f) => f.kind === "changes") && p.state === "address")
    r.push({ text: `changes requested on ${at}`, weight: 3, pr: prRef(p) });
  if (p.state === "re-request")
    r.push({ text: `re-request ${p.rerequest?.join(", ")} on ${at}`, weight: 2, pr: prRef(p) });
  if (p.merge_state === "DIRTY") r.push({ text: `conflicts on ${at}`, weight: 3, pr: prRef(p), handoff: "conflicts" });
  if (p.checks === "failure" || p.checks === "error") r.push({ text: `CI failing on ${at}`, weight: 2, pr: prRef(p), handoff: "ci" });
  // In the merge queue it's GitHub's to merge, unless the queue can't.
  if (p.merge_queue) {
    if (p.merge_queue.state === "UNMERGEABLE") r.push({ text: `merge queue can't merge ${at}`, weight: 3, pr: prRef(p) });
    return r;
  }
  if (p.state === "merge" && p.merge_state !== "DIRTY") {
    if (p.merge_state === "BEHIND") r.push({ text: `${at} approved, behind base`, weight: 1, pr: prRef(p) });
    else if (p.can_merge.startsWith("yes")) r.push({ text: `${at} ready to merge`, weight: 2, pr: prRef(p) });
  }
  return r;
}

/** Why a PR of the user's is with someone else. */
function waitingOn(p: PrRow): string {
  const at = num(p);
  if (p.merge_queue) return `${at} in merge queue, #${p.merge_queue.position}`;
  if (p.state === "handed-off") return `${at} handed to an agent`;
  if (p.state === "addressed") return `${at} addressed, reviewer knows`;
  if (p.draft) return `${at} draft`;
  if (p.checks === "pending") return `${at} CI running`;
  if (p.state === "merge") return `${at} approved, ${p.can_merge}`;
  const who = p.pending_reviewers.map((x) => x.replace(/^@/, ""));
  return who.length ? `${at} with ${who.join(", ")}` : `${at} has no reviewer`;
}

const AGENT_CELL: Record<Agent["status"], Cell> = {
  blocked: { text: "ASK", tone: "pen" }, done: { text: "DONE", tone: "ok" }, working: { text: "WORK", tone: "" },
  idle: { text: "IDLE", tone: "dim" }, unknown: { text: "?", tone: "dim" },
};
const AGENT_RANK: Agent["status"][] = ["blocked", "done", "working", "idle", "unknown"];
const agentName = (a: Agent) => a.name ?? a.label;
/** Finished and not yet looked at from here: herdr's `done`, or a finish herdr counted seen. */
export const isFinished = (a: Agent) => a.status === "done" || (a.status === "idle" && a.finishedSeq !== null);

/** Why an agent needs the user now. */
function agentNeeds(a: Agent): Reason[] {
  if (a.status === "blocked") return [{ text: `agent ${agentName(a)} is waiting on you`, weight: 3 }];
  if (isFinished(a)) return [{ text: `agent ${agentName(a)} finished`, weight: 2 }];
  return [];
}

function agentCell(agents: Agent[]): Cell {
  if (!agents.length) return { text: "·", tone: "dim" };
  const shown = (a: Agent) => (isFinished(a) ? "done" : a.status);
  const top = [...agents].sort((a, b) => AGENT_RANK.indexOf(shown(a)) - AGENT_RANK.indexOf(shown(b)))[0];
  return { ...AGENT_CELL[shown(top)], proof: agents.map((a) => `${agentName(a)}: ${a.status}`).join("\n") };
}

function cellsFor(prs: PrRow[], lane: Lane, agents: Agent[]): WorkItem["cells"] {
  if (!prs.length) {
    const none: Cell = { text: "·", tone: "dim" };
    return { fb: none, ci: none, rv: { text: "—", tone: "dim" }, mg: { text: "—", tone: "dim" }, ag: agentCell(agents) };
  }
  const fbCount = prs.reduce((a, p) => a + (p.feedback?.length ?? 0), 0);
  const fbProof = prs.flatMap((p) => (p.feedback ?? []).map((f) => `${f.who} on ${num(p)}`)).join(", ");
  const fb: Cell = lane === "asked" ? { text: "·", tone: "dim" } : fbCount ? { text: String(fbCount), tone: "pen", proof: fbProof } : { text: "·", tone: "dim" };

  const ci: Cell = prs.some((p) => p.checks === "failure" || p.checks === "error")
    ? { text: "✗", tone: "pen" }
    : prs.some((p) => p.checks === "pending")
      ? { text: "RUN", tone: "" } // drawn as a spinner
      : prs.some((p) => p.checks === "success")
        ? { text: "✓", tone: "ok" }
        : { text: "·", tone: "dim" };
  ci.proof = prs.map((p) => `${num(p)}: ${p.checks}`).join("\n");

  let rv: Cell;
  if (lane === "asked") rv = { text: "YOU", tone: "pen" };
  else {
    const approved = prs.filter((p) => p.review_decision === "APPROVED").length;
    if (approved === prs.length) rv = { text: "APPRVD", tone: "ok" };
    else if (prs.length > 1) rv = { text: `${approved}/${prs.length} ✓`, tone: "" };
    else {
      const who = prs[0].pending_reviewers[0];
      rv = who ? { text: who.replace(/^@/, "").replace(/^hb-/i, "").toUpperCase().slice(0, 7), tone: "" } : { text: "NONE", tone: prs[0].draft ? "dim" : "pen" };
    }
    rv.proof = prs.map((p) => `${num(p)}: ${p.review_decision?.toLowerCase().replace("_", " ") ?? "no decision"}${p.pending_reviewers.length ? `, waiting on ${p.pending_reviewers.join(", ")}` : ""}`).join("\n");
  }

  let mg: Cell;
  if (lane === "asked") mg = { text: "—", tone: "dim" };
  else if (prs.some((p) => p.merge_state === "DIRTY")) mg = { text: "CNFLCT", tone: "pen" };
  else if (prs.some((p) => p.merge_queue)) mg = { text: "QUEUED", tone: "ok" };
  else if (prs.every((p) => p.can_merge.startsWith("yes"))) mg = { text: "READY", tone: "ok" };
  else if (prs.some((p) => p.merge_state === "BEHIND")) mg = { text: "BEHIND", tone: "" };
  else if (prs.every((p) => p.draft)) mg = { text: "DRAFT", tone: "dim" };
  else mg = { text: "WAIT", tone: "dim" };
  if (lane !== "asked") mg.proof = prs.map((p) => `${num(p)}: ${p.can_merge}`).join("\n");

  return { fb, ci, rv, mg, ag: agentCell(agents) };
}

/**
 * ⏎ on a work item, most urgent PR first (Action flows): agent waiting → open it; conflict →
 * hand off; failed CI → update from base when behind, else rerun, or hand off once a rerun failed on the same commit; open
 * feedback → hand off; pushed past feedback → re-request; behind → update branch; else open.
 */
function primaryFor(prs: PrRow[], agents: Agent[], lane: Lane, reran: Set<string>, drafts: Map<string, number>): WorkItem["primary"] {
  const waiting = agents.find((a) => a.status === "blocked") ?? agents.find(isFinished);
  if (waiting) return { label: waiting.status === "blocked" ? "Answer agent" : "Check agent's work", agent: waiting.pane };
  if (!prs.length) return { label: "Show agent", agent: agents[0].pane };
  const busy = agents.some((a) => a.status === "working");
  if (prs[0].role === "requested") {
    const n = drafts.get(prRef(prs[0]));
    if (n) return { label: `Curate ${n} drafted comment${n > 1 ? "s" : ""}`, act: "curate", pr: prRef(prs[0]) };
    if (!busy) return { label: `Review ${num(prs[0])} with an agent`, handoff: "review", pr: prRef(prs[0]) };
    return { label: `Open ${num(prs[0])}`, url: prs[0].url };
  }
  const mine = prs.filter((p) => p.role === "mine");
  const pick = (f: (p: PrRow) => boolean) => mine.find(f);
  let p: PrRow | undefined;
  if (!busy && (p = pick((x) => x.merge_state === "DIRTY"))) return { label: `Fix conflicts on ${num(p)} with an agent`, handoff: "conflicts", pr: prRef(p) };
  if ((p = pick((x) => x.checks === "failure" || x.checks === "error"))) {
    // A fix that landed on the base won't reach a rerun: the rerun tests the same merge.
    if (behind(p)) return { label: `Update ${num(p)} from ${p.base}`, act: "update", pr: prRef(p) };
    if (!reran.has(`${prRef(p)}@${p.head}`)) return { label: `Rerun failed CI on ${num(p)}`, act: "rerun", pr: prRef(p) };
    if (!busy) return { label: `Fix CI on ${num(p)} with an agent`, handoff: "ci", pr: prRef(p) };
  }
  if (!busy && (p = pick((x) => x.state === "address"))) return { label: `Address feedback on ${num(p)} with an agent`, handoff: "feedback", pr: prRef(p) };
  if (!busy && (p = pick((x) => !!drafts.get(prRef(x))))) {
    const n = drafts.get(prRef(p))!;
    return { label: `Fix ${n} self-review finding${n > 1 ? "s" : ""} on ${num(p)} with an agent`, handoff: "fixreview", pr: prRef(p) };
  }
  if ((p = pick((x) => x.state === "re-request"))) return { label: `Re-request ${x(p.rerequest)} on ${num(p)}`, act: "rerequest", pr: prRef(p) };
  if ((p = pick(behind))) return { label: `Update ${num(p)} from ${p.base}`, act: "update", pr: prRef(p) };
  if ((p = pick(mergeable))) return { label: `Merge ${num(p)} on GitHub`, url: p.url };
  const target = pick((x) => x.state === "merge") ?? prs[0];
  return { label: `Open ${num(target)}`, url: target.url };
}
// The merge queue tests against the latest base itself, so a queued PR is never behind for the user.
const behind = (p: PrRow) => !p.merge_queue && (p.merge_state === "BEHIND" || (p.behind_by ?? 0) > 0);
const mergeable = (p: PrRow) => p.role === "mine" && p.state === "merge" && p.merge_state !== "DIRTY" && p.merge_state !== "BEHIND" && p.can_merge.startsWith("yes");
const x = (who: string[] | undefined) => (who ?? []).join(", ");

/** What ended a wait on the author, if anything has: a push, or someone else's activity. */
export function woke(p: PrRow, h: Hold): string | null {
  if (p.head !== h.head) return `${p.author} pushed`;
  if (p.others_activity && ts(p.others_activity) > ts(h.since)) return "new activity";
  return null;
}

function itemFrom(id: string, key: string, keyKind: WorkItem["keyKind"], prs: PrRow[], agents: Agent[], hold: Hold | undefined, reran: Set<string>, drafts: Map<string, number>, blocked: Set<string> = new Set()): WorkItem {
  prs = [...prs].sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number);
  const updated = prs.map((p) => p.last_activity || p.updated).sort((a, b) => ts(b) - ts(a))[0] ?? new Date(0).toISOString();
  const repos = [...new Set([...prs.map((p) => short(p.repo)), ...(prs.length ? [] : agents.flatMap((a) => (a.repo ? [a.repo] : [])))])];
  const newest = [...prs].sort((a, b) => ts(b.updated) - ts(a.updated))[0];
  const working = agents.filter((a) => a.status === "working").map((a) => `agent ${agentName(a)} working`);

  if (keyKind === "review") {
    const p = prs[0];
    const w = hold ? woke(p, hold) : null;
    if (hold && !w) {
      const why = [`waiting on ${p.author}${hold.note ? `: ${hold.note}` : ""}`, ...working].join(" · ");
      return {
        id, key, keyKind, title: cleanTitle(p.title), repos, prs, agents, lane: "waiting", why, urgency: 0,
        updated, cells: cellsFor(prs, "asked", agents), primary: { label: `Open ${num(p)}`, url: p.url }, related: [],
        hold: { ...hold, woke: null },
      };
    }
    const reasons = [...(w ? [{ text: `${w} since you started waiting`, weight: 3 }] : []), ...agents.flatMap(agentNeeds)];
    const why = [p.rereview ? "re-review: pushed since your review" : p.direct ? "asked directly" : "via team", p.author, ...reasons.map((r) => r.text), ...working].join(" · ");
    return {
      id, key, keyKind, title: cleanTitle(p.title), repos, prs, agents, lane: "asked", why,
      urgency: Math.max(p.direct || p.rereview ? 2 : 1, ...reasons.map((r) => r.weight)),
      updated, cells: cellsFor(prs, "asked", agents), primary: primaryFor(prs, agents, "asked", reran, drafts), related: [],
      ...(hold ? { hold: { ...hold, woke: w } } : {}),
    };
  }

  // A blocked PR waits on something else: it asks nothing of the user and its action can't come first.
  const live = prs.filter((p) => !blocked.has(prRef(p)));
  const selfReview = live.flatMap((p): Reason[] => {
    const n = p.role === "mine" ? drafts.get(prRef(p)) : 0;
    return n ? [{ text: `self-review found ${n} on ${num(p)}`, weight: 2, pr: prRef(p), handoff: "fixreview" }] : [];
  });
  const reasons = [...agents.flatMap(agentNeeds), ...live.flatMap(needs), ...selfReview];
  const lane: Lane = reasons.length ? "mine" : "waiting";
  const why = lane === "mine"
    ? [...reasons].sort((a, b) => b.weight - a.weight).map((r) => r.text).join(" · ")
    : [...working, ...prs.map(waitingOn)].join(" · ") || "agent idle";
  const title = newest ? cleanTitle(newest.title) : agents[0].title || agents[0].label;
  return {
    id, key, keyKind, title, repos, prs, agents, lane, why,
    urgency: reasons.reduce((a, r) => Math.max(a, r.weight), 0),
    updated, cells: cellsFor(prs, lane, agents), primary: primaryFor(live.length ? live : prs, agents, lane, reran, drafts), related: [],
  };
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Branch prefixes that say what kind of change it is, not which piece of work.
const BRANCH_TYPES = new Set(["fix", "feat", "feature", "chore", "ci", "refactor", "docs", "test", "hotfix", "bug", "build", "perf", "release", "dependabot", "renovate", "beekeeper"]);

/** A branch's work: `retire-pru/2-app-account` belongs with `retire-pru/3-postgres`; `fix/x` is just `fix/x`. */
export function branchFamily(branch: string): string {
  const [head, ...rest] = branch.split("/");
  return rest.length && !BRANCH_TYPES.has(head.toLowerCase()) ? head : branch;
}

type Group = { key: string; kind: WorkItem["keyKind"]; prs: PrRow[]; agents: Agent[] };

/**
 * The user's PRs grouped by Jira key, else Sentry key, else branch; review requests one per PR.
 * An agent joins the work item of its worktree's branch, else of a PR, Jira or Sentry key in
 * its tab label, else it joins its repo's own item (a task keeps its key), shown only while it needs
 * looking at or is working.
 * `moves` overrides the key of PRs moved by hand; `blocked` PRs don't count toward the lane.
 */
export function groupWorkItems(rows: PrRow[], agents: Agent[] = [], holds: Map<string, Hold> = new Map(), reran: Set<string> = new Set(), drafts: Map<string, number> = new Map(), moves: Map<string, Move> = new Map(), blocked: Set<string> = new Set()): WorkItem[] {
  const mine = rows.filter((r) => r.role === "mine");
  const requested = rows.filter((r) => r.role === "requested");

  const projects = new Set(KNOWN_PROJECTS);
  for (const r of rows) {
    const k = trackerKey(r.title);
    if (k) projects.add(k.split("-")[0]);
  }

  const keyOf = (p: PrRow) => ({
    jira: trackerKey(p.title) ?? trackerKey(p.branch, projects),
    sentry: errorKey(p.title) ?? errorKey(p.branch),
  });

  // A Sentry issue merges into the Jira issue's work item once a PR names both.
  const sentryToJira = new Map<string, string>();
  for (const p of mine) {
    const { jira, sentry } = keyOf(p);
    if (jira && sentry) sentryToJira.set(sentry, jira);
  }

  const groups = new Map<string, Group>();
  const groupOfPr = new Map<string, string>();
  const groupOfKey = new Map<string, string>();
  const movedInto = new Map<string, string[]>();
  for (const p of mine) {
    const { jira, sentry } = keyOf(p);
    let key: string, kind: WorkItem["keyKind"], id: string;
    if (jira) [key, kind] = [jira, "jira"];
    else if (sentry && sentryToJira.has(sentry)) [key, kind] = [sentryToJira.get(sentry)!, "jira"];
    else if (sentry) [key, kind] = [sentry, "sentry"];
    else [key, kind] = [branchFamily(p.branch), "branch"];
    id = kind === "branch" ? `b-${slug(short(p.repo))}-${slug(key)}` : slug(key);
    if (moves.has(prRef(p))) {
      const to = moves.get(prRef(p));
      if (to) [id, key, kind] = [to.id, to.key, to.kind];
      else [id, key, kind] = [`s-${slug(short(p.repo))}-${p.number}`, num(p), "branch"];
      movedInto.set(id, [...(movedInto.get(id) ?? []), prRef(p)]);
    }
    const g = groups.get(id) ?? { key, kind, prs: [], agents: [] };
    g.prs.push(p);
    groups.set(id, g);
    groupOfPr.set(`${short(p.repo)}#${p.number}`.toLowerCase(), id);
    groupOfPr.set(`${short(p.repo)}@${p.branch}`.toLowerCase(), id);
    groupOfPr.set(`${short(p.repo)}@@${p.head}`, id);
    if (kind !== "branch") groupOfKey.set(key, id);
    if (sentry) groupOfKey.set(sentry, id);
  }

  const reviewIds = new Map<string, string>();
  for (const p of requested) {
    const id = `r-${slug(short(p.repo))}-${p.number}`;
    groups.set(id, { key: num(p), kind: "review", prs: [p], agents: [] });
    groupOfPr.set(`${short(p.repo)}#${p.number}`.toLowerCase(), id);
    groupOfPr.set(`${short(p.repo)}@${p.branch}`.toLowerCase(), id);
    reviewIds.set(id, keyOf(p).jira ?? "");
  }

  // RCA tabs name a Sentry issue by its tail ("rca client-m" for ABC-3-CLIENT-M).
  const tails = [...groupOfKey.entries()].filter(([k]) => errorKey(k) === k).map(([k, id]) => [k.split("-").slice(-2).join("-").toLowerCase(), id]);
  const sentryTail = (text: string) => {
    const words = text.toLowerCase().split(/[\s/_]+/).flatMap((w) => [w, w.replace(/^rca-/, "")]);
    return tails.find(([tail]) => words.includes(tail))?.[1] ?? null;
  };

  for (const a of agents) {
    const text = `${a.label} ${a.name ?? ""}`;
    const ref = text.match(/([\w.-]+)#(\d+)/);
    const sentry = errorKey(text);
    const jira = trackerKey(text, projects);
    const id =
      (a.repo && a.branch && groupOfPr.get(`${a.repo}@${a.branch}`.toLowerCase())) ||
      (a.repo && a.upstream && groupOfPr.get(`${a.repo}@${a.upstream}`.toLowerCase())) ||
      (a.repo && a.head && groupOfPr.get(`${a.repo}@@${a.head}`)) ||
      (ref && groupOfPr.get(`${ref[1]}#${ref[2]}`.toLowerCase())) ||
      (jira && groupOfKey.get(jira)) ||
      (sentry && (groupOfKey.get(sentry) ?? groupOfKey.get(sentryToJira.get(sentry) ?? ""))) ||
      sentryTail(text) ||
      null;
    if (id) { groups.get(id)!.agents.push(a); continue; }
    // An agent of its own is on the board only while it needs looking at or is working.
    if ((a.status === "idle" && a.finishedSeq === null) || a.status === "unknown") continue;
    // A task keeps its own key; any other session without a work item belongs to its repo.
    const key = jira ?? sentry ?? (a.label.startsWith("task-") || !a.repo ? a.label : a.repo);
    const own = `a-${slug(key)}`;
    const g = groups.get(own) ?? { key, kind: "agent" as const, prs: [], agents: [] };
    g.agents.push(a);
    groups.set(own, g);
  }

  const items = [...groups.entries()].map(([id, g]) =>
    itemFrom(id, g.key, g.kind, g.prs, g.agents, g.kind === "review" ? holds.get(prRef(g.prs[0])) : undefined, reran, drafts, blocked));
  for (const it of items) if (movedInto.has(it.id)) it.moved = movedInto.get(it.id);
  const byJira = new Map(items.filter((i) => i.keyKind === "jira").map((i) => [i.key, i.id]));
  for (const it of items) {
    const jira = reviewIds.get(it.id);
    if (!jira) continue;
    it.key = jira;
    const own = byJira.get(jira);
    if (own) it.related = [own];
  }
  return items;
}

/**
 * What ends a park, if anything has: the timer, an agent of the item waiting for input (its question
 * is the why), or a person doing something new on it (human feedback or a mention on the user's PRs;
 * activity by others on a review request). Bots, CI and the user's own pushes don't.
 */
export function parkWoke(it: WorkItem, park: Park, now = Date.now()): string | null {
  if (park.until && Date.parse(park.until) <= now) return "timer's up";
  const asking = it.agents.find((a) => a.status === "blocked");
  if (asking) {
    const q = asking.title.trim();
    return `agent ${asking.name ?? asking.label} ${q ? `asks: “${q.length > 140 ? `${q.slice(0, 139)}…` : q}”` : "is waiting for input"}`;
  }
  for (const p of it.prs) {
    const fresh = (p.feedback ?? []).find((f) => !f.bot && ts(f.at) > ts(park.setAt));
    if (fresh) return `${fresh.who} ${fresh.kind === "changes" ? "requested changes" : "commented"}`;
    if (p.role === "requested" && p.others_activity && ts(p.others_activity) > ts(park.setAt)) return `${p.author} did something new`;
  }
  return null;
}

/** Parked items leave their lanes (and stay silent) until they wake. */
export function applyParks(items: WorkItem[], parks: Map<string, Park>, now = Date.now()): WorkItem[] {
  return items.map((it) => {
    const park = parks.get(it.id);
    if (!park) return it;
    const woke = parkWoke(it, park, now);
    if (woke) return { ...it, ...(it.agents.some((a) => a.status === "blocked") ? { lane: "mine" as const } : {}), park: { ...park, woke }, why: `woke: ${woke} · ${it.why}` };
    const until = park.until ? ` · until ${new Date(park.until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
    return { ...it, lane: "parked", urgency: 0, why: `${park.note ? `“${park.note}”` : "parked"}${until}`, park: { ...park, woke: null } };
  });
}

/** What lifted a dependency, or null while it holds: a PR dependency lifts when that PR merges; a step dependency when the user lifts it. */
export const dependencyOpened = (g: Dependency, merged: Set<string>) => (g.on && merged.has(g.on) ? `${g.on.split("/").pop()} merged` : null);

/** The PRs still held by a dependency; groupWorkItems leaves them out of the lane. */
export const shutGates = (dependencies: Map<string, Dependency>, merged: Set<string>) => new Set([...dependencies.values()].filter((g) => !dependencyOpened(g, merged)).map((g) => g.ref));

/** Puts dependencies on their work items and says so in the why. */
export function applyGates(items: WorkItem[], dependencies: Map<string, Dependency>, merged: Set<string>): WorkItem[] {
  return items.map((it) => {
    const all = it.prs.flatMap((p) => (dependencies.has(prRef(p)) ? [dependencies.get(prRef(p))!] : [])).map((g) => ({ ...g, opened: dependencyOpened(g, merged) }));
    if (!all.length) return it;
    const shut = all.filter((g) => !g.opened).map((g) => `${g.ref.split("/").pop()} blocked on ${g.on ? g.on.split("/").pop() : g.step}`);
    const lifted = all.filter((g) => g.opened).map((g) => `unblocked: ${g.opened}`);
    const why = it.lane === "waiting" ? [...lifted, ...shut, it.why] : [...lifted, it.why, ...shut];
    return { ...it, dependencies: all, why: why.join(" · ") };
  });
}

/** Today's finished work items: PRs that merged or closed since `since`, grouped the way the board does, minus any still open on it. */
export function finishedToday(rows: { ref: string; at: string; state: "merged" | "closed"; title: string; url: string; repo: string; branch: string }[], items: WorkItem[], keyOf: (title: string, branch: string, repo: string) => string, since: string): FinishedItem[] {
  const open = new Set(items.flatMap((it) => [it.key, ...it.prs.map((p) => keyOf(p.title, p.branch, p.repo))]));
  const by = new Map<string, FinishedItem>();
  for (const r of rows) {
    if (r.at < since) continue;
    const key = keyOf(r.title, r.branch, r.repo);
    if (open.has(key)) continue;
    const f = by.get(key) ?? { key, title: cleanTitle(r.title), repos: [], at: r.at, prs: [] };
    const repo = short(r.repo);
    if (!f.repos.includes(repo)) f.repos.push(repo);
    f.prs.push({ ref: r.ref, url: r.url, title: r.title, state: r.state });
    if (r.at > f.at) f.at = r.at;
    by.set(key, f);
  }
  return [...by.values()].sort((a, b) => b.at.localeCompare(a.at));
}

// Statuses past the point a PR moves an issue along: someone else has it, or it's set aside.
const PAST = /review|qa|merged|deployed|blocked|parking/i;
// Product testing statuses (GLOSSARY: Product testing): never "no PR yet".
const ACCEPTANCE = new Set([SETTINGS.flow?.testingStatus, SETTINGS.flow?.approvedStatus].filter(Boolean).map((x) => x!.toLowerCase()));
const to = (j: Issue, re: RegExp) => j.transitions.find((t) => re.test(t.to) && t.to !== j.status);
const suggestion = (j: Issue, t: Issue["transitions"][number] | undefined, why: string): Suggested | null =>
  t ? { key: j.key, from: j.status, to: t.to, id: t.id, why } : null;

/** The status change a work item's PRs call for: open for review → a review status; work started → In Progress. */
export function suggestFor(j: Issue, prs: PrRow[]): Suggested | null {
  if (j.category === "done") return null;
  const mine = prs.filter((p) => p.role === "mine");
  if (mine.some((p) => !p.draft) && !PAST.test(j.status)) return suggestion(j, to(j, /review/i), "a PR is open for review");
  if (mine.length && j.category === "new") return suggestion(j, to(j, /^in progress$/i), "a PR is open");
  return null;
}

/** For a work item that finished today: every PR merged, so the issue can move on. */
export function suggestFinished(j: Issue, f: FinishedItem): Suggested | null {
  if (j.category === "done" || !f.prs.length || f.prs.some((p) => p.state !== "merged")) return null;
  return suggestion(j, to(j, /merged/i) ?? to(j, /^done$/i), "every PR merged");
}

export type JiraCtx = { branchesFor?: (key: string) => ItemBranch[]; mergedPrs?: (key: string) => string[]; parkOf?: (issue: Issue, branches: ItemBranch[]) => ParkState };

/**
 * Puts Jira on the board: each Jira work item gets its issue's status, its branches and a suggested
 * move. An issue of the user's actively In Progress with nothing on the board yet becomes a work item of
 * its own in My turn, with Start as its action. An issue in product testing (GLOSSARY: Product
 * testing) takes the lane acceptanceLane gives it, and never the Start path: an approved one whose
 * branch reached the last stage leaves the board. Agent-only items named by the key take the issue in.
 */
export function applyJira(items: WorkItem[], issues: Map<string, Issue>, ctx: JiraCtx = {}): WorkItem[] {
  const branchesOf = ctx.branchesFor ?? (() => []);
  const mergedOf = ctx.mergedPrs ?? (() => []);
  const withBranches = (it: WorkItem, bs: ItemBranch[]) => (bs.length ? { ...it, branches: bs } : it);
  const out = items.map((it) => {
    const j = it.keyKind === "jira" || it.keyKind === "agent" ? issues.get(it.key) : undefined;
    if (!j) return it;
    const jira = { status: j.status, url: j.url, summary: j.summary, suggest: suggestFor(j, it.prs), parent: j.parent ?? null };
    let next: WorkItem = { ...it, jira, keyKind: "jira" as const, title: it.prs.length ? it.title : j.summary };
    // Open PRs keep their own lane, unless product handed the ball back.
    const t = acceptanceLane(j, branchesOf(j.key), mergedOf(j.key));
    if (t && (t.outcome === "failed" || t.outcome === "question"))
      next = { ...next, lane: "mine", why: [t.why, next.why].filter(Boolean).join(" · "), urgency: Math.max(next.urgency, t.urgency), primary: t.primary };
    return withBranches(next, branchesOf(j.key));
  });
  const onBoard = new Set(out.map((it) => it.key));
  for (const j of issues.values()) {
    if (!j.mine || onBoard.has(j.key)) continue;
    const bs = branchesOf(j.key);
    const base = {
      id: slug(j.key), key: j.key, keyKind: "jira" as const, title: j.summary, repos: [...new Set(bs.map((b) => short(b.repo)))], prs: [], agents: [],
      updated: j.updated ?? new Date(0).toISOString(), cells: cellsFor([], "mine", []), related: [],
      jira: { status: j.status, url: j.url, summary: j.summary, suggest: null, parent: j.parent ?? null },
      ...(bs.length ? { branches: bs } : {}),
    };
    const t = acceptanceLane(j, bs, mergedOf(j.key));
    // A park rule outranks the lane. Its issue keeps its action, so the next step is one click away.
    const rule = ctx.parkOf?.(j, bs) ?? { state: "none" as const };
    if (rule.state === "finished") continue;
    if (rule.state === "parked" || rule.state === "woke") {
      const primary = t?.primary ?? { label: `Open ${j.key}`, url: j.url };
      if (rule.state === "woke") out.push({ ...base, lane: "mine", why: rule.why, urgency: 1, primary });
      else out.push({ ...base, lane: "parked", why: `“${rule.note}”`, urgency: 0, primary, park: { item: base.id, setAt: rule.since, until: null, note: rule.note, woke: null } });
      continue;
    }
    if (t) {
      if (t.finished) continue;
      out.push({ ...base, lane: t.lane, why: t.why, urgency: t.urgency, primary: t.primary,
        ...(t.lane === "parked" ? { park: { item: base.id, setAt: base.updated, until: null, note: t.note ?? "", woke: null } } : {}) });
      continue;
    }
    // An acceptance status without its testing facts still never asks to start.
    if (ACCEPTANCE.has(j.status.toLowerCase())) continue;
    // In review, parked or blocked with no PR open: nothing to do here.
    if (j.category !== "indeterminate" || PAST.test(j.status)) continue;
    const why = bs.length ? `${j.status} in the tracker · ${branchLine(bs)}` : `${j.status} in the tracker, no PR yet`;
    out.push({ ...base, lane: "mine", why, urgency: 1, primary: { label: `Start ${j.key}`, start: j.url } });
  }
  return out;
}

/**
 * Suggestions the user picked up that nothing on the board covers yet, such as an assign-only pickup of a
 * To Do issue, or any pickup in dev: each one is a work item of its own in My turn. A done issue goes.
 */
export function applyPicked(items: WorkItem[], picked: Record<string, { at: string; summary: string; url: string | null }>, issues: Map<string, Issue>): WorkItem[] {
  const onBoard = new Set(items.map((it) => it.key));
  const out = [...items];
  for (const [key, p] of Object.entries(picked)) {
    const j = issues.get(key);
    if (onBoard.has(key) || j?.category === "done") continue;
    const url = j?.url ?? p.url;
    out.push({
      id: slug(key), key, keyKind: "jira", title: j?.summary ?? p.summary, repos: [], prs: [], agents: [], updated: p.at,
      cells: cellsFor([], "mine", []), related: [], lane: "mine", why: "Picked up, not started", urgency: 1,
      primary: { label: `Start ${key}`, start: url ?? key },
      ...(j ? { jira: { status: j.status, url: j.url, summary: j.summary, suggest: null, parent: j.parent ?? null } } : {}),
    });
  }
  return out;
}

/** Approved issues whose branch reached the last stage: Finished, by key. */
export function approvedShipped(issues: Map<string, Issue>, branchesFor: (key: string) => ItemBranch[]): Issue[] {
  return [...issues.values()].filter((j) => outcomeOf(j) === "approved" && reachedLast(branchesFor(j.key)));
}

/**
 * An unattended run whose agent has finished hands the work item back: its action is to review what
 * the run left (RCA, draft PR or skip reason, Jira drafts). It holds until dismissed.
 */
export function applyRuns(items: WorkItem[], runs: Map<string, Run>): WorkItem[] {
  return items.map((it) => {
    const run = runs.get(it.key);
    if (!run || it.agents.some((a) => a.status === "working" || a.status === "blocked")) return it;
    const why = `unattended run finished · ${it.why}`;
    return { ...it, lane: it.lane === "parked" ? it.lane : "mine", why, urgency: Math.max(it.urgency, 2), primary: { label: `Review run ${it.key}`, run: it.key } };
  });
}

const STEPS: NextStep[] = ["answer", "start", "quick", "check", "look"];

/**
 * Which step of the Next queue a work item's primary action belongs to, or null when it's not
 * The user's move: an agent stuck on him first, then handoffs (agents work while he does the rest),
 * then acts that take seconds, then finished agents and review drafts, then anything else.
 */
export function nextStep(it: WorkItem): NextStep | null {
  if (it.lane !== "mine" && it.lane !== "asked") return null;
  const pa = it.primary;
  if (pa.agent) {
    const a = it.agents.find((x) => x.pane === pa.agent);
    return a?.status === "blocked" ? "answer" : a && isFinished(a) ? "check" : null;
  }
  if (pa.handoff || pa.start) return "start";
  if (pa.act === "curate" || pa.run) return "check";
  if (pa.act) return "quick";
  if (it.prs.some((p) => p.url === pa.url && mergeable(p))) return "quick";
  // Anything else with an agent on it is the agent's move.
  return it.agents.some((a) => a.status === "working") ? null : "look";
}

/** Numbers the Next queue: by step, then most urgent, then stalest. */
export function rankNext(items: WorkItem[]): WorkItem[] {
  const steps = new Map(items.map((it) => [it.id, nextStep(it)]));
  const queue = items.filter((it) => steps.get(it.id)).sort((a, b) =>
    STEPS.indexOf(steps.get(a.id)!) - STEPS.indexOf(steps.get(b.id)!) || b.urgency - a.urgency || ts(a.updated) - ts(b.updated));
  const rank = new Map(queue.map((it, i) => [it.id, i + 1]));
  return items.map((it) => (rank.has(it.id) ? { ...it, next: { rank: rank.get(it.id)!, step: steps.get(it.id)! } } : it));
}

const LANE_ORDER: Lane[] = ["mine", "waiting", "asked", "parked"];

/** In Next queue order within a lane, then most urgent, then stalest. */
export function sortItems(items: WorkItem[]): WorkItem[] {
  const rank = (it: WorkItem) => it.next?.rank ?? Infinity;
  return [...items].sort((a, b) =>
    LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane) || rank(a) - rank(b) || b.urgency - a.urgency || ts(a.updated) - ts(b.updated));
}
