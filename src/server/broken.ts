// Known-broken CI: one cause that fails a check on every PR in a repo (a runner image, a flaky service).
// The user notes it once on the board instead of telling each session. While it stands, those failures
// ask nothing of the user and agents are told not to rerun or fix them; when the fix lands on the base,
// clearing it updates every open PR of the user's in that repo, so nobody asks "merge main in?" per PR.
// It also starts a conflicts agent on its own when a PR of the user's starts conflicting.
import type { PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { DEV } from "./config";
import { db, load, save } from "./db";
import { updateBranch } from "./actions";

db.exec("CREATE TABLE IF NOT EXISTS broken_checks (repo TEXT PRIMARY KEY, note TEXT NOT NULL, set_at TEXT NOT NULL)");

export type Broken = { repo: string; note: string; setAt: string };
const short = (repo: string) => repo.split("/").pop()!.toLowerCase();

export function brokenAll(): Map<string, Broken> {
  return new Map(db.query<{ repo: string; note: string; set_at: string }, []>("SELECT * FROM broken_checks").all().map((r) => [r.repo, { repo: r.repo, note: r.note, setAt: r.set_at }]));
}

export function setBroken(repo: string, note: string) {
  if (!note.trim()) throw new Error("say what's broken, so agents know to leave it");
  db.query("INSERT INTO broken_checks (repo, note, set_at) VALUES (?, ?, ?) ON CONFLICT(repo) DO UPDATE SET note = excluded.note, set_at = excluded.set_at").run(short(repo), note.trim(), new Date().toISOString());
}

const failing = (p: PrRow) => p.checks === "failure" || p.checks === "error";

/** A failing PR in a repo with a known break: its failure asks nothing of the user. Pure. */
export function withBroken(broken: Map<string, Broken>) {
  return (p: PrRow): PrRow => (p.role === "mine" && failing(p) && broken.has(short(p.repo)) ? { ...p, checks: "known-broken" } : p);
}

/** The line a prompt carries while a repo's CI is known broken. Pure. */
export function brokenPrompt(b: Broken | undefined): string {
  return b ? `\n\nCI in ${b.repo} is known broken right now: ${b.note}. Don't rerun it, don't try to fix it in this PR and don't count it against the change; the control room updates the branch once the fix lands.` : "";
}
export const brokenFor = (repo: string) => brokenAll().get(short(repo));

/** The PRs to update once a repo's break is fixed: the user's open ones there, failing or behind, without conflicts. Pure. */
export function toUpdate(items: WorkItem[], repo: string): { item: string; p: PrRow }[] {
  return items.flatMap((it) => it.prs.filter((p) => p.role === "mine" && short(p.repo) === short(repo) && !p.draft && !p.merge_queue && p.merge_state !== "DIRTY"
    && (p.checks === "known-broken" || failing(p) || p.merge_state === "BEHIND" || (p.behind_by ?? 0) > 0)).map((p) => ({ item: it.id, p })));
}

/** The fix landed: the note goes, and every PR it held up is updated from its base. */
export async function clearBroken(repo: string, items: WorkItem[]): Promise<string[]> {
  db.query("DELETE FROM broken_checks WHERE repo = ?").run(short(repo));
  const out: string[] = [];
  for (const { item, p } of toUpdate(items, repo)) {
    try { out.push(`${prRef(p)}: ${await updateBranch({ item, trigger: "broken-fixed" }, p)}`); }
    catch (e) { out.push(`${prRef(p)}: ${(e as Error).message}`); }
  }
  return out;
}

// Conflicts that already got an agent, by PR and head: each conflict starts one, once.
let started: Record<string, string> = load<Record<string, string>>("auto_conflicts") ?? {};

/** PRs whose new conflict should start an agent now. Pure: not parked, nothing working on the item, not already started at this head. */
export function conflictsDue(items: WorkItem[], done: Record<string, string>): { it: WorkItem; p: PrRow }[] {
  return items.flatMap((it) => {
    if (it.lane === "parked" || it.agents.some((a) => a.status === "working" || a.status === "blocked")) return [];
    return it.prs.filter((p) => p.role === "mine" && p.merge_state === "DIRTY" && done[prRef(p)] !== p.head).map((p) => ({ it, p }));
  });
}

let busy = false;
/** Starts one conflicts agent per publish for a PR that started conflicting. It merges and commits locally, and asks before pushing. */
export async function startConflicts(items: WorkItem[], lowMemory: boolean, start: (it: WorkItem, p: PrRow) => Promise<unknown>) {
  if (busy || DEV || lowMemory) return;
  const due = conflictsDue(items, started)[0];
  if (!due) return;
  busy = true;
  started = { ...started, [prRef(due.p)]: due.p.head };
  save("auto_conflicts", started);
  try { await start(due.it, due.p); }
  catch (e) { console.log(new Date().toISOString(), `conflicts agent on ${prRef(due.p)} didn't start:`, (e as Error).message); }
  finally { busy = false; }
}
