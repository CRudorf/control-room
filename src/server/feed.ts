import { trackerIssues } from "./tracker";
import { checksFor, startChecks } from "./checks";
import { startFeedbackTasks, withTasks } from "./feedbacktask";
import { lastAction, myLastActions } from "./lastaction";
import { SETTINGS } from "./settings";
import { PROJECT } from "./repos";
// Keeps the board's PR rows fresh and tells subscribers when the board changes.
import type { Dependency, Move, PrRow, Snapshot } from "../shared/types";
import { prRef } from "../shared/types";
import { DETECT_EVERY_MS, DEV, POLL, PRS, RECONCILE_EVERY_MS } from "./config";
import { db, load, save } from "./db";
import { note as record, read, write } from "./runner";
import { behindBy, detect, diff, fetchOne, prState, reconcile, type Fingerprints } from "./github";
import { herdrState, sendToAgent, startHerdr } from "./herdr";
import { reranHeads } from "./actions";
import { pendingDrafts, readDrafts } from "./review";
import { announce } from "./notifier";
import { dismissRun, runs } from "./runs";
import { pickedNow } from "./suggestions";
import { quietAgentsByKey, slug, applyGates, applyJira, applyPicked, approvedShipped, applyCommentWaits, applyParks, applyRuns, runMovedOn, finishedToday, groupWorkItems, rankNext, shutGates, sortItems, suggestFinished } from "./workitems";
import { jiraError, jiraIssues, startJira, transition } from "./jira";
import { noteSessions, startUsage, usageFor } from "./usage";
import { machine, type Machine } from "./health";
import { artifactsFor, startArtifacts } from "./artifacts";
import { featureOf } from "./metrics";
import { staleNudges } from "./nudges";
import { recordPlaces } from "./events";
import { tellsFor } from "./tellagents";
import { cycle, loopsNow } from "./reviewloop";
import { applyLoop, owned, running, views } from "./cycle";
import { applyGuides, startGuides } from "./guides";
import { findStacks, withStack } from "./stacks";
import { branchesFor, startBranches } from "./branches";
import { prFacts } from "./history";
import { recordBounces } from "./product";
import type { FinishedItem, Issue, ItemBranch, Run, WorkItem } from "../shared/types";
import { parkState, type RulePark } from "./parkrules";

type Saved = { user: string; rows: PrRow[]; fps: Fingerprints; polledAt: string | null; reconciledAt: string | null };

const saved = load<Saved>("feed");
let user = saved?.user ?? "";
let rows = new Map<string, PrRow>((saved?.rows ?? []).map((r) => [prRef(r), r]));
let fps: Fingerprints = saved?.fps ?? {};
let polledAt = saved?.polledAt ?? null;
let reconciledAt = saved?.reconciledAt ?? null;
let error: string | null = null;
let busy = false;
// Notifications start once this run has polled GitHub and heard from herdr, so the
// first announcement (a summary) sees the whole board.
let polledThisRun = false;
const BUILD = `${process.pid}-${Date.now()}`;

const listeners = new Set<(s: Snapshot) => void>();
let last = "";

type HoldRow = { ref: string; set_at: string; head: string; since: string; note: string };
const holds = () => new Map(db.query<HoldRow, []>("SELECT * FROM holds").all()
  .map((r) => [r.ref, { ref: r.ref, setAt: r.set_at, head: r.head, since: r.since, note: r.note }]));

/** Waiting on author: hand a review request back until its author acts (or stop waiting). */
export function setHold(ref: string, note: string | null) {
  if (note === null) db.query("DELETE FROM holds WHERE ref = ?").run(ref);
  else {
    const p = rows.get(ref);
    if (!p) throw new Error(`${ref} isn't on the board`);
    db.query("INSERT OR REPLACE INTO holds (ref, set_at, head, since, note) VALUES (?, ?, ?, ?, ?)")
      .run(ref, new Date().toISOString(), p.head, p.others_activity ?? p.last_activity, note);
  }
  publish();
}

type ParkRow = { item: string; set_at: string; until: string | null; note: string };
const parks = () => new Map(db.query<ParkRow, []>("SELECT * FROM parked").all()
  .map((r) => [r.item, { item: r.item, setAt: r.set_at, until: r.until, note: r.note }]));

const detail = (item: string | null) => ({ item, trigger: "detail" });

// Park rules: which issues a rule parked, and which the user took off Parked by hand.
const PARK_RULES = SETTINGS.flow?.parkRules ?? [];
let ruleParks = load<Record<string, RulePark>>("rule_parks") ?? {};
let released = new Set(load<string[]>("rule_released") ?? []);
const parkOf = (j: Issue, bs: ItemBranch[]) => parkState(j, bs, PARK_RULES, ruleParks[j.key], released.has(slug(j.key)));

/** Remembers what the rules parked, and records each issue a rule finished, once. */
function settleRuleParks(issues: Map<string, Issue>, onBoard: Set<string>) {
  if (!PARK_RULES.length) return;
  const next: Record<string, RulePark> = {};
  const stillReleased = new Set<string>();
  for (const j of issues.values()) {
    if (!j.mine) continue;
    const bs = branchesFor(j.key), s = parkOf(j, bs);
    if (PARK_RULES.some((r) => r.status.toLowerCase() === j.status.toLowerCase()) && released.has(slug(j.key))) stillReleased.add(slug(j.key));
    if (s.state === "parked" || s.state === "woke") next[j.key] = { status: s.rule.status, at: s.since };
    else if (s.state === "finished" && onBoard.has(j.key)) { if (ruleParks[j.key]) next[j.key] = ruleParks[j.key]; }
    else if (s.state === "finished")
      db.query("INSERT OR IGNORE INTO finished_items (key, at, title, url, status, why, repos) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(j.key, new Date().toISOString(), j.summary, j.url, j.status, s.why, JSON.stringify([...new Set(bs.map((b) => b.repo.split("/").pop()!))]));
  }
  if (JSON.stringify(next) !== JSON.stringify(ruleParks)) save("rule_parks", (ruleParks = next));
  if (stillReleased.size !== released.size) { released = stillReleased; save("rule_released", [...released]); }
}

type FinishedItemRow = { key: string; at: string; title: string; url: string; status: string; why: string; repos: string };
const ruleFinishedSince = (since: string): FinishedItem[] =>
  db.query<FinishedItemRow, [string]>("SELECT * FROM finished_items WHERE at >= ? ORDER BY at DESC").all(since)
    .map((r) => ({ key: r.key, title: r.title, repos: JSON.parse(r.repos), at: r.at, prs: [], why: r.why, url: r.url }));

/** The Finished page: every work item that finished since `since`, newest first. */
export function finishedSince(since: string): FinishedItem[] {
  const facts = prFacts().filter((f) => (f.merged ?? f.closed ?? "") >= since);
  const rows = [
    ...facts.map((f) => ({ ref: f.ref, at: (f.merged ?? f.closed)!, state: (f.merged ? "merged" : "closed") as "merged" | "closed", title: f.title, url: f.url, repo: f.repo, branch: f.branch ?? "" })),
    ...db.query<FinishedRow, [string]>("SELECT * FROM finished WHERE at >= ?").all(since),
  ].filter((r, i, all) => all.findIndex((x) => x.ref === r.ref) === i);
  const by = new Map(finishedToday(rows, snapshot().items, featureOf, since).map((f) => [f.key, f]));
  const started = new Map<string, string>();
  for (const f of prFacts()) if (!started.has(f.feature) || f.created < started.get(f.feature)!) started.set(f.feature, f.created);
  const issues = new Map([...jiraIssues(), ...trackerIssues()]);
  for (const r of ruleFinishedSince(since)) {
    const had = by.get(r.key);
    by.set(r.key, had ? { ...had, why: r.why, url: r.url, at: r.at > had.at ? r.at : had.at } : r);
  }
  for (const [k, at] of approvedSeen) if (at >= since && !by.has(k)) {
    const j = issues.get(k);
    by.set(k, { key: k, title: j?.summary ?? k, repos: [], at, prs: [], why: "approved and shipped", url: j?.url });
  }
  return [...by.values()].map((f) => ({ ...f, url: f.url ?? issues.get(f.key)?.url, startedAt: started.get(f.key) })).sort((a, b) => b.at.localeCompare(a.at));
}

/** Parks a work item (note, optional until), or unparks it with note null. */
export function setPark(item: string, note: string | null, until: string | null) {
  if (note === null) {
    db.query("DELETE FROM parked WHERE item = ?").run(item);
    // An issue a rule parked stays off Parked until its status changes.
    if (Object.keys(ruleParks).some((k) => slug(k) === item)) { released.add(item); save("rule_released", [...released]); }
  }
  else db.query("INSERT OR REPLACE INTO parked (item, set_at, until, note) VALUES (?, ?, ?, ?)").run(item, new Date().toISOString(), until, note);
  record(detail(item), note === null ? "unpark" : "park", item, note === null ? "unparked" : `${note}${until ? ` until ${until}` : ""}`);
  publish();
}

const commentWaits = () => load<Record<string, string>>("comment_waits") ?? {};

/** Starts a wait for a comment on an issue, or ends it. Only comments newer than the start count. */
export function setCommentWait(key: string, on: boolean) {
  const all = commentWaits();
  if (on) all[key] = new Date().toISOString(); else delete all[key];
  save("comment_waits", all);
  record(detail(slug(key)), on ? "wait-for-comment" : "stop-waiting", key, on ? "waiting for a comment" : "stopped waiting");
  publish();
}

type DependencyRow = { ref: string; set_at: string; on_ref: string | null; step: string };
const dependencies = () => new Map(db.query<DependencyRow, []>("SELECT * FROM dependencies").all()
  .map((r) => [r.ref, { ref: r.ref, setAt: r.set_at, on: r.on_ref, step: r.step } satisfies Dependency]));

/** Dependencies a PR on another PR merging or on a named step; `on` and `step` both null lifts it. */
export function setDependency(ref: string, on: string | null, step: string | null, item: string | null) {
  if (!on && !step) db.query("DELETE FROM dependencies WHERE ref = ?").run(ref);
  else db.query("INSERT OR REPLACE INTO dependencies (ref, set_at, on_ref, step) VALUES (?, ?, ?, ?)").run(ref, new Date().toISOString(), on, step ?? "");
  record(detail(item), on || step ? "dependency" : "remove-dependency", ref, on || step ? `blocked on ${on ?? step}` : "lifted");
  publish();
}

const efforts = () => new Map(db.query<{ item_key: string; effort: string }, []>("SELECT item_key, effort FROM efforts").all().map((r) => [r.item_key, r.effort]));

/** Puts a work item in an effort, by its key, or takes it out with `effort` null. Local only. */
export function setEffort(key: string, effort: string | null) {
  if (!effort) db.query("DELETE FROM efforts WHERE item_key = ?").run(key);
  else db.query("INSERT OR REPLACE INTO efforts (item_key, effort, set_at) VALUES (?, ?, ?)").run(key, effort, new Date().toISOString());
  record(detail(null), effort ? "effort" : "no-effort", key, effort ? `in ${effort}` : "out of its effort");
  publish();
}

type MoveRow = { ref: string; into_item: string | null; into_key: string | null; into_kind: string | null };
const moves = () => new Map<string, Move>(db.query<MoveRow, []>("SELECT * FROM moves").all()
  .map((r) => [r.ref, r.into_item ? { id: r.into_item, key: r.into_key!, kind: r.into_kind as NonNullable<Move>["kind"] } : null]));

/** Moves a PR into another work item, or out on its own (`into` null); `reset` puts it back where its key says. */
export function setMove(ref: string, into: Move, reset: boolean) {
  if (reset) db.query("DELETE FROM moves WHERE ref = ?").run(ref);
  else db.query("INSERT OR REPLACE INTO moves (ref, into_item, into_key, into_kind) VALUES (?, ?, ?, ?)").run(ref, into?.id ?? null, into?.key ?? null, into?.kind ?? null);
  record(detail(into?.id ?? null), reset ? "unmove" : into ? "attach" : "split", ref, reset ? "back to its own key" : into ? `into ${into.key}` : "its own work item");
  publish();
}

const agentMoves = () => new Map(Object.entries(load<Record<string, Move>>("agent_moves") ?? {}));

/** Moves an agent into another work item, or out on its own (`into` null); `reset` lets its names decide again. */
export function setAgentMove(agent: string, into: Move, reset: boolean) {
  const all = Object.fromEntries(agentMoves());
  if (reset) delete all[agent]; else all[agent] = into;
  save("agent_moves", all);
  record(detail(into?.id ?? null), reset ? "unmove" : into ? "attach" : "split", agent, reset ? "back to what its names say" : into ? `into ${into.key}` : "its own work item");
  publish();
}

type FinishedRow = { ref: string; at: string; state: "merged" | "closed"; title: string; url: string; repo: string; branch: string };
const merged = () => new Set(db.query<{ ref: string }, []>("SELECT ref FROM finished WHERE state = 'merged'").all().map((r) => r.ref));
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

/** The user's PRs that left the board: remember the ones that merged or closed, for Finished today and dependencies. */
async function recordGone(gone: PrRow[]) {
  for (const p of gone) {
    if (p.role !== "mine") continue;
    try {
      const s = await prState(prRef(p));
      if (s.state === "open") continue;
      db.query("INSERT OR REPLACE INTO finished (ref, at, state, title, url, repo, branch) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(prRef(p), s.at ?? new Date().toISOString(), s.state, p.title, p.url, p.repo, p.branch);
    } catch (e) { log(`couldn't tell how ${prRef(p)} left:`, (e as Error).message); }
  }
}

const prsCmd = (...args: string[]) => read(["python3", PRS, ...args]);

/** Hides PRs, or whole repos, through prs.py's exclude list, and drops them from the board now. */
export async function remove(item: string, keys: string[], why: string) {
  for (const k of keys) {
    await write(detail(item), "remove", k, () => prsCmd("exclude", k, why).then(() => why || "removed"));
    const repoOnly = !k.includes("#");
    for (const [ref, r] of rows) {
      const name = r.repo.split("/").pop()!.toLowerCase();
      const hit = repoOnly ? [r.repo.toLowerCase(), name].includes(k.toLowerCase()) : ref.toLowerCase() === k.toLowerCase() || `${name}#${r.number}` === k.toLowerCase();
      if (hit && !DEV) rows.delete(ref);
    }
  }
  publish();
}

/** Takes over someone else's PR (`note` set) or hands it back (`note` null), through prs.py's list. */
export async function adopt(ref: string, note: string | null, item: string | null) {
  await write(detail(item), note === null ? "hand-back" : "take-over", ref, () => prsCmd(note === null ? "unadopt" : "adopt", ref, ...(note ? [note] : []))
    .then(() => note === null ? "handed back" : `took over${note ? `: ${note}` : ""}`));
  const row = await fetchOne(ref, note === null ? "requested" : "mine").catch(() => null);
  if (row) rows.set(ref, row);
  else rows.delete(ref);
  if (fps[ref]) fps[ref] = { ...fps[ref], section: note === null ? "requested" : "mine" };
  publish();
}

export const removed = async () => JSON.parse(await prsCmd("excluded", "--json")) as { key: string; why: string }[];

/** Takes a key off the exclude list; the next reconcile brings its PRs back. */
export async function restore(key: string) {
  await write(detail(null), "restore", key, () => prsCmd("include", key).then(() => "restored"));
  void refresh();
}

// "PR|reviewer" → when the user last nudged them about it; a nudge restarts that wait's clock.
const nudged = new Map<string, string>(Object.entries(load<Record<string, string>>("nudged") ?? {}));

/** Puts plain text on the clipboard. */
export async function copy(text: string) {
  const p = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  p.stdin.write(text);
  p.stdin.end();
  if ((await p.exited) !== 0) throw new Error("pbcopy failed");
}

/** Copies a Slack review ask for a work item, and records it. */
export async function copyAsk(item: string, text: string) {
  await copy(text);
  record(detail(item), "slack-ask", item, "copied for Slack");
}

/** Copies a reviewer's nudge for Slack and restarts the clock on the PRs it covers. */
export async function nudge(reviewer: string, text: string) {
  const n = snapshot().nudges.find((x) => x.reviewer === reviewer);
  if (!n) throw new Error(`nothing is waiting on ${reviewer}`);
  await copy(text);
  const at = new Date().toISOString();
  for (const x of n.prs) nudged.set(`${x.ref}|${reviewer}`, at);
  save("nudged", Object.fromEntries(nudged));
  record(detail(n.prs[0].item), "nudge", reviewer, `copied for Slack: ${n.prs.map((x) => x.ref).join(", ")}`);
  publish();
}

/** "repo#12" to its work item's key, for PRs that left the board: history, then the PRs seen to finish. */
let refKeys: { at: number; by: Map<string, string> } | null = null;
const keyOfRef = (ref: string) => {
  if (!refKeys || Date.now() - refKeys.at > 60_000) {
    const by = new Map<string, string>();
    const name = (r: string) => r.split("/").pop()!.toLowerCase();
    for (const f of prFacts()) by.set(name(f.ref), f.feature);
    for (const r of db.query<FinishedRow, []>("SELECT * FROM finished").all()) by.set(name(r.ref), featureOf(r.title, r.branch, r.repo));
    refKeys = { at: Date.now(), by };
  }
  return refKeys.by.get(ref) ?? null;
};

/** A work item's merged PRs, by the user's PR history: "repo#N". */
let mergedCache: { at: number; by: Map<string, string[]> } | null = null;
const mergedPrs = (key: string) => {
  if (!mergedCache || Date.now() - mergedCache.at > 60_000) {
    const by = new Map<string, string[]>();
    for (const f of prFacts()) if (f.merged) by.set(f.feature, [...(by.get(f.feature) ?? []), `${f.repo.split("/").pop()}#${f.number}`]);
    mergedCache = { at: Date.now(), by };
  }
  return mergedCache.by.get(key) ?? [];
};

// Approved issues that reached the last stage, and when the board first saw it: Finished that day.
const approvedSeen = new Map<string, string>(Object.entries(load<Record<string, string>>("approved_finished") ?? {}));
function approvedFinished(issues: ReturnType<typeof jiraIssues>, since: string): FinishedItem[] {
  let changed = false;
  const out: FinishedItem[] = [];
  for (const j of approvedShipped(issues, branchesFor)) {
    if (!approvedSeen.has(j.key)) { approvedSeen.set(j.key, new Date().toISOString()); changed = true; }
    const at = approvedSeen.get(j.key)!;
    if (at >= since) out.push({ key: j.key, title: j.summary, repos: [...new Set(branchesFor(j.key).map((b) => b.repo.split("/").pop()!))], at, prs: [] });
  }
  if (changed) save("approved_finished", Object.fromEntries(approvedSeen));
  return out;
}

export function snapshot(): Snapshot {
  const h = herdrState();
  const [gs, done] = [dependencies(), merged()];
  // A PR in a loop round asks nothing of the user, like a blocked one: its agent has it.
  const all = [...rows.values()];
  // A self-review's findings count until the user pushes past the commit they were found on.
  const drafts = pendingDrafts();
  for (const p of all) {
    const ref = `${p.repo}#${p.number}`, d = p.role === "mine" && drafts.has(ref) ? readDrafts(ref) : null;
    if (d && !(p.head.startsWith(d.sha) || d.sha.startsWith(p.head))) drafts.delete(ref);
  }
  const grouped = groupWorkItems(all.map(withBehind).map(withStack(all)), h.agents, holds(), reranHeads(), drafts, moves(), new Set([...shutGates(gs, done), ...running(loopsNow())]), { keyOfRef, agentMoves: agentMoves() });
  const issues = new Map([...jiraIssues(), ...trackerIssues()]);
  const ef = efforts();
  const quiet = quietAgentsByKey(h.agents, { keyOfRef, agentMoves: agentMoves() });
  const movedOn = (run: Run, it: WorkItem) => runMovedOn(run, it, issues.get(it.key), prFacts().filter((f) => f.feature === it.key && f.merged).map((f) => f.merged!));
  const blocked = applyRuns(applyGates(applyPicked(applyJira(grouped, issues, { branchesFor, mergedPrs, parkOf, quietAgents: (k) => quiet.get(k) ?? [] }), pickedNow(), issues), gs, done), runs(), movedOn);
  for (const it of grouped) { const run = runs().get(it.key); if (run && movedOn(run, it)) dismissRun(it.key, it.id); }
  const mine = myLastActions();
  // A wait ends for good when its issue is done.
  const waits = commentWaits();
  const openWaits = Object.fromEntries(Object.entries(waits).filter(([k]) => issues.get(k)?.category !== "done"));
  if (Object.keys(openWaits).length !== Object.keys(waits).length) save("comment_waits", openWaits);
  const waited = applyCommentWaits(applyLoop(blocked, views(blocked, loopsNow())), openWaits, issues, { branchesFor, quietAgents: (k) => quiet.get(k) ?? [] });
  const items = sortItems(rankNext(applyGuides(applyParks(waited, parks()))))
    .map((it) => {
      const u = usageFor(it), a = artifactsFor(it), e = ef.get(it.key), c = checksFor(it.prs);
      return { ...withTasks(it), last: lastAction(it, mine.get(it.id) ?? null), ...(c.length ? { stopChecks: c } : {}), ...(u ? { usage: u } : {}), ...(a.length ? { artifacts: a } : {}), ...(e ? { effort: e } : {}) };
    });
  settleRuleParks(issues, new Set(items.map((it) => it.key)));
  const today = db.query<FinishedRow, [string]>("SELECT * FROM finished WHERE at >= ? ORDER BY at").all(midnight());
  const finished = finishedToday(today, items, featureOf, midnight())
    .map((f) => (issues.has(f.key) ? { ...f, suggest: suggestFinished(issues.get(f.key)!, f) } : f));
  for (const f of approvedFinished(issues, midnight())) if (!finished.some((x) => x.key === f.key)) finished.push(f);
  for (const f of ruleFinishedSince(midnight())) if (!finished.some((x) => x.key === f.key)) finished.push(f);
  return {
    user, items, nudges: staleNudges(items, nudged), finished, jiraError: jiraError(), machine: lastMachine, polledAt, reconciledAt, error,
    herdr: { up: h.up, error: h.error }, dev: DEV, build: BUILD, project: PROJECT, flow: { stages: SETTINGS.flow?.stages, copySuffix: SETTINGS.flow?.copySuffix },
  };
}

export function subscribe(fn: (s: Snapshot) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Feedback keys already accounted for: told to an agent, or there before any agent could be told.
let told: Set<string> | null = load<string[]>("told") ? new Set(load<string[]>("told")) : null;

function tellAgents(items: Snapshot["items"]) {
  // Self-reviews with findings still open on the PR's head go back to the PR's own session.
  const pending = pendingDrafts();
  const reviews = new Map(items.flatMap((it) => it.prs).flatMap((p) => {
    const d = p.role === "mine" && pending.has(prRef(p)) ? readDrafts(prRef(p)) : null;
    return d && (p.head.startsWith(d.sha) || d.sha.startsWith(p.head)) ? [[prRef(p), d] as const] : [];
  }));
  const { tells, current } = tellsFor(items, told, owned(loopsNow()), reviews);
  const changed = !told || told.size !== current.size || [...current].some((k) => !told!.has(k));
  told = current;
  if (changed) save("told", [...current]);
  for (const t of tells) {
    sendToAgent(t.pane, t.text, t.item, "feedback").catch((e) => {
      log(`telling ${t.pane} about feedback failed:`, (e as Error).message);
      // Try again on the next publish.
      for (const k of t.keys) told?.delete(k);
      save("told", [...(told ?? [])]);
    });
  }
}

export function publish() {
  const s = snapshot();
  const h = herdrState();
  if ((polledThisRun || !POLL) && (h.up || h.error)) {
    announce(s.items);
    recordPlaces(s.items);
    tellAgents(s.items);
    noteSessions(s.items);
    recordBounces(jiraIssues().values(), branchesFor, mergedPrs);
    void cycle(s.items, !!s.machine?.low, publish);
    void startGuides(s.items, !!s.machine?.low, publish);
    // A wake has been announced: the park is over.
    for (const it of s.items) if (it.park?.woke) db.query("DELETE FROM parked WHERE item = ?").run(it.id);
    // So has a lifted dependency.
    for (const it of s.items) for (const g of it.dependencies ?? []) if (g.opened) db.query("DELETE FROM dependencies WHERE ref = ?").run(g.ref);
  }
  const body = JSON.stringify([s.items, s.nudges, s.finished, s.error, s.herdr, s.machine?.low]);
  save("feed", { user, rows: [...rows.values()], fps, polledAt, reconciledAt } satisfies Saved);
  if (body === last) return;
  last = body;
  for (const fn of listeners) fn(s);
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function full() {
  const d = await detect();
  const r = await reconcile();
  user = r.user;
  const before = rows;
  rows = new Map(r.rows.map((x) => [prRef(x), x]));
  await recordGone([...before.values()].filter((p) => !rows.has(prRef(p))));
  fps = d.fps;
  reconciledAt = polledAt = new Date().toISOString();
  log(`reconciled: ${rows.size} PRs`);
}

async function tick() {
  const d = await detect();
  const { dirty, gone } = diff(fps, d.fps);
  const left: PrRow[] = [];
  for (const k of gone) { if (rows.has(k)) left.push(rows.get(k)!); rows.delete(k); }
  for (const k of dirty) {
    const row = await fetchOne(k, d.fps[k].section);
    if (row) rows.set(k, row);
    else { if (rows.has(k)) left.push(rows.get(k)!); rows.delete(k); }
  }
  await recordGone(left);
  fps = d.fps;
  polledAt = new Date().toISOString();
  if (d.overflow) error = "more than 50 open PRs: some are missing";
  if (dirty.length || gone.length) log(`changed: ${dirty.join(", ") || "-"}; gone: ${gone.join(", ") || "-"}`);
}

// How far behind its base each failing PR of the user's is, by repo, base and head. A count above
// zero holds until the head moves; zero is checked again after BEHIND_TTL_MS, as the base moves.
const BEHIND_TTL_MS = 10 * 60_000;
const behindCache = new Map<string, { n: number; at: number }>();
const behindKey = (p: PrRow) => `${p.repo}|${p.base}|${p.head}`;
const failing = (p: PrRow) => p.role === "mine" && (p.checks === "failure" || p.checks === "error");

async function checkBehind() {
  for (const p of rows.values()) {
    if (!failing(p)) continue;
    const c = behindCache.get(behindKey(p));
    if (c && (c.n > 0 || Date.now() - c.at < BEHIND_TTL_MS)) continue;
    try { behindCache.set(behindKey(p), { n: await behindBy(p), at: Date.now() }); }
    catch (e) { log(`behind check failed for ${prRef(p)}:`, (e as Error).message); }
  }
}
const withBehind = (p: PrRow): PrRow => {
  const c = failing(p) ? behindCache.get(behindKey(p)) : undefined;
  return c ? { ...p, behind_by: c.n } : p;
};

async function step(kind: "full" | "tick") {
  if (busy) return;
  busy = true;
  try {
    await (kind === "full" ? full() : tick());
    await checkBehind();
    await findStacks([...rows.values()]);
    error = null;
    polledThisRun = true;
  } catch (e) {
    error = String((e as Error).message ?? e);
    log("feed error:", error);
  } finally {
    busy = false;
    publish();
  }
}

/** Refetches one PR after an action on it, so the board moves without waiting for a poll. */
export async function refetch(ref: string) {
  const p = rows.get(ref);
  if (!p) return;
  const row = await fetchOne(ref, p.role === "mine" ? "mine" : p.rereview ? "reviewed" : "requested").catch(() => p);
  if (row) rows.set(ref, row);
  else { rows.delete(ref); await recordGone([p]); }
  publish();
}

/** Refetch now, e.g. when the UI asks. */
export const refresh = () => step("full");

/** Every Jira key the board shows, for the Jira feed. */
const jiraKeys = () => {
  const s = snapshot();
  // An issue a rule parked stays in the query after it moves to a done status, so that move can finish it.
  return [...Object.keys(ruleParks), ...Object.keys(commentWaits()), ...s.items.filter((i) => i.keyKind === "jira").map((i) => i.key), ...s.finished.map((f) => f.key).filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k))];
};

/** Moves a work item's Jira issue as the board suggested. */
export const moveJira = (item: string | null, key: string, to: string) => transition(item, key, to, jiraKeys(), publish);

// Checked every minute; the board's header warns when memory runs short.
let lastMachine: Machine | null = null;
const checkMachine = async () => { lastMachine = await machine().catch(() => lastMachine); publish(); };

export function start() {
  startHerdr(publish);
  void checkMachine();
  setInterval(() => void checkMachine(), 60_000);
  startJira(jiraKeys, publish);
  // Branches named with any key on the board, from a tracker or an error report, and the acceptance ones (GLOSSARY: Branch).
  if (POLL) startBranches(() => [...new Set([...snapshot().items.filter((i) => i.keyKind === "sentry").map((i) => i.key), ...jiraKeys(), ...[...jiraIssues().values()].filter((j) => j.testing).map((j) => j.key)])], publish);
  startUsage(publish);
  startArtifacts(publish);
  startChecks(publish);
  startFeedbackTasks(publish);
  if (!POLL) {
    log("polling off (dev); serving the saved snapshot. Pass --poll to poll.");
    return;
  }
  const stale = !reconciledAt || Date.now() - Date.parse(reconciledAt) > RECONCILE_EVERY_MS;
  void step(stale ? "full" : "tick");
  setInterval(() => void step("tick"), DETECT_EVERY_MS);
  setInterval(() => void step("full"), RECONCILE_EVERY_MS);
}
