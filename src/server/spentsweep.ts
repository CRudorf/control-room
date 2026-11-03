// The sweep for spent sessions (spent.ts): finds them, shows them on their agents, and closes the exact
// ones after a grace period unless the user kept them. Closing ends the pane; reap() then takes its
// worktree once nothing in it can be lost.
import type { Agent, Snapshot, WorkItem } from "../shared/types";
import { closeAgent, herdrState } from "./herdr";
import { prFacts } from "./history";
import { load, save } from "./db";
import { isDev, note, read } from "./runner";
import { doneLine, spentOf, type Spent } from "./spent";
import { startedAt, taskOf } from "./tasks";
import { agentTurn } from "./turns";
import { listRuns } from "./verify";
import { listVisuals } from "./visuals";

export const GRACE_MS = 30 * 60_000;
const EVERY_MS = 60_000;

export type SpentNow = Spent & { since: string; closesAt: string | null };
// pane → when it was first seen spent, and why. Kept panes are never closed by the sweep.
const seen = new Map<string, SpentNow>(Object.entries(load<Record<string, SpentNow>>("spent") ?? {}));
const kept = new Set<string>(load<string[]>("spent_kept") ?? []);
// pane → why git kept it open: it stays spent, for the user to close.
const held = new Map<string, string>();
let lastAt = 0, running = false;

export const spentOfPane = (pane: string) => seen.get(pane) ?? null;

/** The user keeps a spent session: no auto-close, and no banner until it finishes something new. */
export function keepAgent(pane: string) {
  kept.add(pane);
  save("spent_kept", [...kept]);
  seen.delete(pane);
  save("spent", Object.fromEntries(seen));
}

/** Nothing in its folder that a close would strand: no uncommitted files, every commit on a remote. */
async function safeToClose(a: Agent): Promise<string | null> {
  try {
    const dirty = (await read(["git", "-C", a.cwd, "status", "--porcelain"])).trim();
    if (dirty) return "uncommitted files";
    const ahead = Number((await read(["git", "-C", a.cwd, "rev-list", "--count", "HEAD", "--not", "--remotes"])).trim());
    if (ahead) return "commits not on a remote";
    return null;
  } catch (e) {
    return `git could not read it: ${(e as Error).message.slice(0, 80)}`;
  }
}

/** Runs at most once a minute from publish(). */
export function sweepSpent(s: Snapshot, changed: () => void) {
  const now = Date.now();
  if (running || now - lastAt < EVERY_MS) return;
  lastAt = now;
  running = true;
  void sweep(s.items, now).then((c) => c && changed()).catch((e) => console.log("spent sweep failed:", (e as Error).message)).finally(() => { running = false; });
}

async function sweep(items: WorkItem[], now: number): Promise<boolean> {
  const agents = herdrState().agents;
  const itemOf = new Map(items.flatMap((it) => it.agents.map((a) => [a.pane, it] as const)));
  const charts = listVisuals({ kind: "chart" }).map((v) => ({ pr: v.pr, createdAt: v.createdAt, url: `chart: ${v.title}` }));
  const runs = listRuns().map((r) => ({ agent: r.agent, reported: r.checks.length > 0 && r.checks.every((c) => c.status !== "pending" && c.status !== "testing"), url: `verification ${r.id}` }));
  const ended = new Map<string, "merged" | "closed">(prFacts().flatMap((f) => (f.branch && (f.merged || f.closed) ? [[f.branch, f.merged ? "merged" : "closed"] as const] : [])));
  let changed = false;
  const open = new Set(agents.map((a) => a.pane));
  for (const pane of [...seen.keys()]) if (!open.has(pane)) { seen.delete(pane); changed = true; }
  for (const pane of [...kept]) if (!open.has(pane)) kept.delete(pane);
  for (const a of agents) {
    const t = taskOf(a);
    const it = itemOf.get(a.pane) ?? null;
    const sp = kept.has(a.pane) ? null : spentOf({
      a: { ...a, task: t.task }, it, done: a.status === "working" ? undefined : doneLine(agentTurn(a).turn), startedAt: startedAt(a.pane), charts, runs, ended, now,
    });
    const was = seen.get(a.pane);
    if (!sp) { held.delete(a.pane); if (was) { seen.delete(a.pane); changed = true; } continue; }
    const since = was?.since ?? new Date(now).toISOString();
    const hold = held.get(a.pane);
    const next: SpentNow = { ...sp, reason: hold ? `${sp.reason}; left open: ${hold}` : sp.reason, since, closesAt: sp.exact && !hold ? new Date(Date.parse(since) + GRACE_MS).toISOString() : null };
    if (JSON.stringify(next) !== JSON.stringify(was)) { seen.set(a.pane, next); changed = true; }
    if (!next.closesAt || now < Date.parse(next.closesAt)) continue;
    const why = await safeToClose(a);
    if (why) { held.set(a.pane, why); note({ item: it?.id ?? null, trigger: "spent" }, "auto-close", `${a.workspaceLabel} / ${a.label}`, `left open: ${why}`); changed = true; continue; }
    if (isDev()) continue;
    note({ item: it?.id ?? null, trigger: "spent" }, "auto-close", `${a.workspaceLabel} / ${a.label}`, sp.reason, { detail: { pane: a.pane, output: sp.output } });
    await closeAgent(a.pane, it?.id ?? null).catch((e) => console.log(`closing spent ${a.pane} failed:`, (e as Error).message));
    seen.delete(a.pane);
    changed = true;
  }
  if (changed) { save("spent", Object.fromEntries(seen)); save("spent_kept", [...kept]); }
  return changed;
}

