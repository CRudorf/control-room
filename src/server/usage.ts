import { CLAUDE_DIR } from "./repos";
import { dirInProject, repoOfDir } from "./repos";
// Reads Claude Code's transcripts for token use, a file at a time from where the last scan stopped,
// and attributes each session's turns to a work item by its repo and branch (tokens.ts does the sums).
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Usage, UsageCoeffs, UsageTotals, WorkItem } from "../shared/types";
import { POLL } from "./config";
import { db, load, save } from "./db";
import { METRICS_FROM, prFacts } from "./history";
import { featureOf } from "./metrics";
import { DEFAULT_COEFFS, PRICES_AS_OF, sum, tally, turnOf, WEIGHTS, type Turn } from "./tokens";

const ROOT = join(CLAUDE_DIR, "projects");
const EVERY_MS = 10 * 60_000;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_turns (
    id TEXT PRIMARY KEY, at TEXT NOT NULL, session TEXT NOT NULL, model TEXT NOT NULL, dir TEXT NOT NULL, branch TEXT NOT NULL,
    input INTEGER NOT NULL, output INTEGER NOT NULL, read INTEGER NOT NULL, write5m INTEGER NOT NULL, write1h INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS usage_turns_at ON usage_turns (at);
  CREATE TABLE IF NOT EXISTS usage_files (path TEXT PRIMARY KEY, offset INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS usage_sessions (session TEXT PRIMARY KEY, item_key TEXT NOT NULL, repo TEXT);
`);

const insert = db.query(`INSERT OR IGNORE INTO usage_turns (id, at, session, model, dir, branch, input, output, read, write5m, write1h)
  VALUES ($id, $at, $session, $model, $dir, $branch, $input, $output, $read, $write5m, $write1h)`);
const setOffset = db.query("INSERT INTO usage_files (path, offset) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET offset = excluded.offset");
const offsets = () => new Map(db.query<{ path: string; offset: number }, []>("SELECT * FROM usage_files").all().map((r) => [r.path, r.offset]));

/** Reads whatever was appended to each transcript since the last scan. A partial last line waits for the next. */
async function scan() {
  const seen = offsets();
  let added = 0;
  for await (const rel of new Bun.Glob("**/*.jsonl").scan({ cwd: ROOT })) {
    const path = join(ROOT, rel);
    const from = seen.get(path) ?? 0;
    const size = statSync(path).size;
    if (size <= from) continue;
    const bytes = new Uint8Array(await Bun.file(path).slice(from, size).arrayBuffer());
    const end = bytes.lastIndexOf(0x0a);
    if (end < 0) continue;
    const lines = new TextDecoder().decode(bytes.subarray(0, end)).split("\n");
    db.transaction(() => {
      for (const l of lines) {
        const t = turnOf(l);
        if (t && dirInProject(t.dir)) added += insert.run(Object.fromEntries(Object.entries(t).map(([k, v]) => [`$${k}`, v])) as any).changes;
      }
      setOffset.run(path, from + end + 1);
    })();
  }
  return added;
}

// A working directory's repo: its clone's origin remote, so a worktree or a second clone counts as
// the repo it's of. A directory that's gone falls back to its folder under ~/Projects.
const repoCache = new Map<string, string | null>();
function repoOf(dir: string): string | null {
  const top = repoOfDir(dir);
  if (!top) return null;
  if (repoCache.has(top)) return repoCache.get(top)!;
  let repo: string | null = basename(top);
  try {
    const cfg = readFileSync(join(top, ".git", "config"), "utf8");
    const url = cfg.match(/\[remote "origin"\][^[]*?url = (.+)/)?.[1]?.trim();
    if (url) repo = basename(url).replace(/\.git$/, "");
  } catch {
    // A worktree's .git is a file pointing into its main clone.
    try {
      const gitdir = readFileSync(join(top, ".git"), "utf8").match(/gitdir: (.+)/)?.[1]?.trim();
      if (gitdir) repo = basename(dirname(dirname(dirname(gitdir))));
    } catch {}
  }
  repoCache.set(top, repo);
  return repo;
}

const TRUNKS = new Set(["main", "master", "plan", "develop", "HEAD", ""]);

// Branches that say nothing about the work: the trunk, and the scratch branch `claude --worktree` starts on.
const placeholder = (b: string) => TRUNKS.has(b) || b.startsWith("worktree-");

const sessionItems = () => new Map(db.query<{ session: string; item_key: string }, []>("SELECT session, item_key FROM usage_sessions").all().map((r) => [r.session, r.item_key]));
const putSession = db.query("INSERT INTO usage_sessions (session, item_key, repo) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET item_key = excluded.item_key, repo = excluded.repo");

/**
 * Remembers which work item each herdr agent's Claude session works on, as the board joins them.
 * That beats the branch: an agent can sit on a checkout of something else.
 */
export function noteSessions(items: WorkItem[]) {
  const known = sessionItems();
  let fresh = false;
  for (const it of items) for (const a of it.agents) {
    if (!a.session || !it.prs.length || known.get(a.session) === it.key) continue;
    putSession.run(a.session, it.key, a.repo);
    fresh = true;
  }
  if (fresh) rebuild();
}

/**
 * The work item key for a turn: the work item its session was seen working on; else its PR's, when
 * its branch has one; else the branch's own key. A turn
 * on a placeholder branch counts toward the branch its session went on to; one that never left it
 * counts toward the repo's trunk. Sessions outside ~/Projects (plugins' background agents) go by folder.
 */
function keyer(turns: Turn[]) {
  const byBranch = new Map<string, string>();
  for (const p of prFacts()) if (p.branch) byBranch.set(`${p.repo.split("/").pop()}@${p.branch}`, p.feature);
  const sessionBranch = new Map<string, string>();
  for (const t of turns) if (!placeholder(t.branch)) sessionBranch.set(t.session, t.branch);
  const bySession = sessionItems();
  return (t: Turn) => {
    const repo = repoOf(t.dir);
    if (bySession.has(t.session)) return { key: bySession.get(t.session)!, repo };
    if (!repo) return { key: `outside a repo: ${basename(t.dir) || "?"}`, repo };
    const branch = placeholder(t.branch) ? sessionBranch.get(t.session) ?? t.branch : t.branch;
    if (placeholder(branch)) return { key: `${repo}:${TRUNKS.has(branch) ? branch || "no branch" : "unbranched worktree"}`, repo };
    return { key: byBranch.get(`${repo}@${branch}`) ?? featureOf("", branch, repo), repo };
  };
}

/** A session the board ties to a work item, for the friction review: when it ran, how long, and where its transcript is. */
export type TrackedSession = { session: string; item: string; repo: string | null; from: string; to: string; turns: number; transcript: string | null };

/**
 * Sessions grouped from their turns, with the work item each went by. Sessions that never left a trunk,
 * or ran outside a repo, aren't tied to a work item and are left out. Pure.
 */
export function sessionsOf(turns: Turn[], keyOf: (t: Turn) => { key: string; repo: string | null }, transcriptOf: (session: string) => string | null): TrackedSession[] {
  const by = new Map<string, TrackedSession>();
  for (const t of turns) {
    const s = by.get(t.session);
    if (s) { s.to = t.at; s.turns++; continue; }
    by.set(t.session, { session: t.session, item: "", repo: null, from: t.at, to: t.at, turns: 1, transcript: transcriptOf(t.session) });
  }
  // The item a session went by is its last turn's: a session starts on a trunk and moves to its branch.
  const last = new Map(turns.map((t) => [t.session, t]));
  return [...by.values()].flatMap((s) => {
    const { key, repo } = keyOf(last.get(s.session)!);
    if (key.startsWith("outside a repo") || (repo && key.startsWith(`${repo}:`))) return [];
    return [{ ...s, item: key, repo }];
  });
}

/** Every tracked session since `from`, oldest first. */
export function trackedSessions(from: string): TrackedSession[] {
  const turns = db.query<Turn, [string]>("SELECT * FROM usage_turns WHERE at >= ? ORDER BY at").all(from);
  const files = new Map(db.query<{ path: string }, []>("SELECT path FROM usage_files").all().map((r) => [basename(r.path, ".jsonl"), r.path]));
  return sessionsOf(turns, keyer(turns), (s) => files.get(s) ?? null);
}

export const coeffs = (): UsageCoeffs => ({ ...DEFAULT_COEFFS, ...(load<UsageCoeffs>("usage_coeffs") ?? {}) });
export function setCoeffs(c: Partial<UsageCoeffs>) {
  const next = { ...coeffs(), ...Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "number" && v >= 0)) };
  save("usage_coeffs", next);
  rebuild();
}

let scannedAt: string | null = load<string>("usage_scanned");
let cached: Pick<Usage, "items" | "weeks"> = { items: [], weeks: [] };
let byKey = new Map<string, UsageTotals>();

function rebuild() {
  const turns = db.query<Turn, []>("SELECT * FROM usage_turns ORDER BY at").all();
  cached = tally(turns, keyer(turns), coeffs(), METRICS_FROM);
  byKey = new Map(cached.items.map((i) => [i.key, i]));
}

export const usage = (): Usage => ({ coeffs: coeffs(), weights: { ...WEIGHTS }, scannedAt, from: METRICS_FROM, pricesAsOf: PRICES_AS_OF, ...cached });

/**
 * A board work item's totals: every key its PRs go by. An agent's branch counts only on an item with
 * no PR, since an agent joined by its tab label can be checked out on other work.
 */
export function usageFor(it: WorkItem): UsageTotals | undefined {
  const keys = new Set([it.key]);
  // By title and by branch alone: a PR that isn't in the user's history (taken over, or a review) has its turns keyed by branch.
  for (const p of it.prs) { keys.add(featureOf(p.title, p.branch, p.repo)); keys.add(featureOf("", p.branch, p.repo.split("/").pop()!)); }
  if (!it.prs.length) for (const a of it.agents) if (a.repo && a.branch && !placeholder(a.branch)) keys.add(featureOf("", a.branch, a.repo));
  const found = [...keys].flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  return found.length ? sum(found) : undefined;
}

let running: Promise<void> | null = null;
export function syncUsage(changed: () => void): Promise<void> {
  running ??= (async () => {
    try {
      const n = await scan();
      scannedAt = new Date().toISOString();
      save("usage_scanned", scannedAt);
      rebuild();
      if (n) log(`usage: ${n} new turns`);
      changed();
    } catch (e) { log("usage scan failed:", (e as Error).message); }
  })().finally(() => { running = null; });
  return running;
}

export function startUsage(changed: () => void) {
  rebuild();
  if (!POLL && !existsSync(ROOT)) return;
  void syncUsage(changed);
  setInterval(() => void syncUsage(changed), EVERY_MS);
}
