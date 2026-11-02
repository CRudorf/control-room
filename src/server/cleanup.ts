// Cleanup: what work leaves behind. The control room reaps what it owns (the worktrees of dead
// verification runs, chart folders that never got a result). Other worktrees go only when the user asks,
// and only when git and the process list prove that nothing can be lost.
import { projectRepos, repoPath } from "./repos";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { herdrState } from "./herdr";
import { isDev, note, read, type Ctx } from "./runner";
import { listRuns, stopRun, VERIFY_DIR } from "./verify";
import { VISUALS_DIR } from "./visuals";

const DAY = 86_400_000;
export const IDLE_MS = DAY;
export const RUN_MAX_MS = DAY;

export type Worktree = { repo: string; path: string; name: string; branch: string | null; safe: boolean; why: string; dirty: number; unpushed: number; inUse: boolean; lastAt: string };
export type Facts = { dirty: number; unpushed: number; inUse: boolean; lastMs: number };

/** Safe means nothing can be lost: no process in it, no uncommitted files, each commit on a remote, and quiet for a day. */
export function classify(f: Facts, now = Date.now()): { safe: boolean; why: string } {
  if (f.inUse) return { safe: false, why: "a process is running in it" };
  if (f.unpushed) return { safe: false, why: `${f.unpushed} commit${f.unpushed > 1 ? "s" : ""} not on a remote` };
  if (f.dirty) return { safe: false, why: `${f.dirty} uncommitted file${f.dirty > 1 ? "s" : ""}` };
  if (now - f.lastMs < IDLE_MS) return { safe: false, why: "used in the last day" };
  return { safe: true, why: "no changes, all commits on a remote" };
}

/** The paths in `git worktree list --porcelain` under the repo's .claude/worktrees, with their branches. */
export function parseWorktrees(out: string, clone: string) {
  const root = join(clone, ".claude", "worktrees") + "/";
  return out.split("\n\n").flatMap((b) => {
    const path = b.match(/^worktree (.+)$/m)?.[1];
    if (!path || !path.startsWith(root)) return [];
    return [{ path, branch: b.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null }];
  });
}

/** Every folder that a process has as its working directory. */
export async function processCwds(): Promise<string[]> {
  const out = await read(["/bin/sh", "-c", "lsof -d cwd -Fn 2>/dev/null; true"]).catch(() => "");
  return out.split("\n").filter((l) => l.startsWith("n/")).map((l) => l.slice(1));
}

const clones = () => projectRepos().map(repoPath);

async function factsOf(path: string, cwds: string[]): Promise<Facts> {
  const status = await read(["git", "-C", path, "status", "--porcelain"]);
  // A verification run's build output and its node_modules link are not work.
  const own = basename(path).startsWith("verify-");
  const dirty = own ? 0 : status.split("\n").filter(Boolean).length;
  const unpushed = Number((await read(["git", "-C", path, "rev-list", "--count", "HEAD", "--not", "--remotes"])).trim()) || 0;
  const lastCommit = Number((await read(["git", "-C", path, "log", "-1", "--format=%ct"])).trim()) * 1000 || 0;
  const inUse = cwds.some((c) => c === path || c.startsWith(path + "/"));
  return { dirty, unpushed, inUse, lastMs: Math.max(lastCommit, statSync(path).mtimeMs) };
}

/** Each worktree under a clone's .claude/worktrees. A worktree git can't read is unsafe. */
export async function listWorktrees(): Promise<Worktree[]> {
  const cwds = await processCwds();
  const all = (await Promise.all(clones().map(async (clone) => {
    const out = await read(["git", "-C", clone, "worktree", "list", "--porcelain"]).catch(() => "");
    return parseWorktrees(out, clone).map((w) => ({ ...w, repo: basename(clone) }));
  }))).flat();
  const res: Worktree[] = [];
  for (let i = 0; i < all.length; i += 12) {
    res.push(...await Promise.all(all.slice(i, i + 12).map(async (w) => {
      const base = { repo: w.repo, path: w.path, name: basename(w.path), branch: w.branch };
      try {
        const f = await factsOf(w.path, cwds);
        return { ...base, ...classify(f), dirty: f.dirty, unpushed: f.unpushed, inUse: f.inUse, lastAt: new Date(f.lastMs).toISOString() };
      } catch (e) {
        return { ...base, safe: false, why: "git could not read it", dirty: 0, unpushed: 0, inUse: false, lastAt: new Date(0).toISOString() };
      }
    })));
  }
  return res.sort((a, b) => Number(b.safe) - Number(a.safe) || a.lastAt.localeCompare(b.lastAt));
}

async function removeOne(repo: string, path: string, branch: string | null) {
  const clone = repoPath(repo);
  await read(["git", "-C", clone, "worktree", "unlock", path]).catch(() => {});
  await read(["git", "-C", clone, "worktree", "remove", "--force", path]);
  // Only the branch Claude made for the worktree. Its commits are on a remote, or it would not be safe.
  if (branch?.startsWith("worktree-")) await read(["git", "-C", clone, "branch", "-D", branch]).catch(() => {});
}

/** Removes the worktrees asked for that are still safe now. The list on the user's screen is not trusted. */
export async function removeWorktrees(ctx: Ctx, paths: string[]) {
  if (isDev()) { note(ctx, "cleanup-worktrees", `${paths.length} asked`, "dry run"); return { removed: 0, kept: [], dryRun: true }; }
  const asked = new Set(paths);
  const now = await listWorktrees();
  let removed = 0; const kept: string[] = [];
  for (const w of now.filter((x) => asked.has(x.path))) {
    if (!w.safe) { kept.push(`${w.name}: ${w.why}`); continue; }
    try { await removeOne(w.repo, w.path, w.branch); removed++; }
    catch (e) { kept.push(`${w.name}: ${(e as Error).message.slice(0, 120)}`); }
  }
  note(ctx, "cleanup-worktrees", `${removed} removed`, kept.length ? `${kept.length} kept` : "done", { detail: { paths, kept } });
  return { removed, kept };
}

/**
 * What the control room reaps by itself. A dead run's worktree goes, and its evidence stays. A run up
 * for a day with no session at work stops. A verify- worktree no run owns goes. A cr- worktree goes once its session closed, if nothing can be lost. A chart folder with no result goes after a day.
 */
export async function reap(now = Date.now()) {
  if (isDev()) return [];
  const done: string[] = [];
  const runs = listRuns();
  for (const r of runs) {
    const working = r.session?.status === "working" || r.session?.status === "blocked";
    const old = r.state === "running" && !working && now - Date.parse(r.startedAt) > RUN_MAX_MS;
    const dead = (r.state === "stopped" || r.state === "failed") && r.worktree && existsSync(r.worktree);
    if (old || dead) { await stopRun({ item: null, trigger: "reap" }, r.id).catch(() => {}); done.push(r.id); }
  }
  const owned = new Set(listRuns().map((r) => r.worktree).filter(Boolean));
  const cwds = await processCwds();
  for (const clone of clones()) {
    const out = await read(["git", "-C", clone, "worktree", "list", "--porcelain"]).catch(() => "");
    for (const w of parseWorktrees(out, clone)) {
      if (!basename(w.path).startsWith("verify-") || owned.has(w.path) || cwds.some((c) => c.startsWith(w.path))) continue;
      if (await read(["git", "-C", w.path, "rev-list", "--count", "HEAD", "--not", "--remotes"]).then((x) => x.trim() !== "0").catch(() => true)) continue;
      await removeOne(basename(clone), w.path, w.branch).then(() => done.push(basename(w.path))).catch(() => {});
    }
  }
  // A session the control room started left its worktree. It goes once the session closed and nothing can be lost.
  const open = new Set(herdrState().agents.map((a) => a.name));
  for (const clone of clones()) {
    const out = await read(["git", "-C", clone, "worktree", "list", "--porcelain"]).catch(() => "");
    for (const w of parseWorktrees(out, clone)) {
      const name = basename(w.path);
      if (!name.startsWith("cr-") || open.has(name)) continue;
      const f = await factsOf(w.path, cwds).catch(() => null);
      if (!f || f.inUse || f.dirty || f.unpushed) continue;
      await removeOne(basename(clone), w.path, w.branch).then(() => done.push(name)).catch(() => {});
    }
  }
  if (existsSync(VISUALS_DIR)) for (const n of readdirSync(VISUALS_DIR)) {
    const d = join(VISUALS_DIR, n);
    if (!statSync(d).isDirectory() || existsSync(join(d, "meta.json")) || now - statSync(d).mtimeMs < DAY) continue;
    rmSync(d, { recursive: true, force: true }); done.push(n);
  }
  if (done.length) note({ item: null, trigger: "reap" }, "cleanup-reap", `${done.length} cleaned`, "done", { detail: { done } });
  return done;
}

/** A run's evidence, when the user deletes it. A running run must stop first. */
export function deleteRun(ctx: Ctx, id: string) {
  const r = listRuns().find((x) => x.id === id);
  if (!r) throw new Error("no such run");
  if (r.state === "running" || r.state === "starting") throw new Error("stop the run first");
  rmSync(join(VERIFY_DIR, id), { recursive: true, force: true });
  note(ctx, "verify-delete", id, "deleted");
}

export function startCleanup() {
  const go = () => void reap().catch((e) => console.log("reap failed:", (e as Error).message));
  setTimeout(go, 60_000);
  setInterval(go, 3600_000);
}
