// Branches: a work item's remote branches, named with its Jira key (GLOSSARY: Branch), in every full
// clone under ~/Projects whose origin is in the settings org. Every BRANCH_EVERY_MS (polling only) it
// fetches each repo once, in turn, and records which matching branches are in each stage of the
// project's flow. All commands go through the runner. A failure keeps the last cache.
import { projectRepos, repoPath } from "./repos";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ItemBranch } from "../shared/types";
import { load, save } from "./db";
import { read } from "./runner";
import { SETTINGS } from "./settings";

export const BRANCH_EVERY_MS = 20 * 60_000;
const STAGES = SETTINGS.flow?.stages ?? [];
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** The cache: per repo (owner/name), the branches that matched a key, and when it was read. */
export type BranchStore = Record<string, { at: string; branches: (ItemBranch & { sha: string })[] }>;
let store: BranchStore = load<BranchStore>("branches") ?? {};
const failedOnce = new Set<string>();

/** Whether a branch name carries a key: case-insensitive, not inside a longer word or number. */
export function nameHasKey(name: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${k}(?![0-9])`, "i").test(name);
}

/** owner/name of a GitHub remote URL, or null. */
export function repoOf(url: string): string | null {
  return url.trim().match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/)?.[1] ?? null;
}

const git = (dir: string, ...args: string[]) => read(["git", "-C", dir, ...args], { timeoutMs: 60_000 });
const ancestor = (dir: string, branch: string, base: string) =>
  git(dir, "merge-base", "--is-ancestor", `origin/${branch}`, `origin/${base}`).then(() => true, () => false);

/** One repo: fetch, then the remote branches that carry any key, with the stages of the flow that each one has reached. */
export async function scanRepo(dir: string, keys: string[]): Promise<(ItemBranch & { sha: string })[]> {
  await git(dir, "fetch", "--prune", "-q", "origin");
  const refs = (await git(dir, "for-each-ref", "--format=%(refname:short)|%(objectname)|%(committerdate:iso-strict)", "refs/remotes/origin"))
    .split("\n").filter(Boolean).map((l) => l.split("|")).map(([ref, sha, at]) => ({ name: ref.replace(/^origin\//, ""), sha, at }));
  const have = new Set(refs.map((r) => r.name));
  const repo = repoOf(await git(dir, "remote", "get-url", "origin")) ?? dir;
  const out: (ItemBranch & { sha: string })[] = [];
  for (const r of refs) {
    if (r.name === "HEAD" || !keys.some((k) => nameHasKey(r.name, k))) continue;
    const stages = await Promise.all(STAGES.map(async (b) => ({ name: b, in: have.has(b) ? await ancestor(dir, r.name, b) : null })));
    out.push({ repo, name: r.name, sha: r.sha, lastCommitAt: r.at, stages });
  }
  return out;
}

/** Full clones under ~/Projects (`.git` a folder), one per origin repo in the settings org. */
async function clones(): Promise<{ dir: string; repo: string }[]> {
  
  const seen = new Set<string>(), out: { dir: string; repo: string }[] = [];
  for (const name of projectRepos()) {
    const dir = repoPath(name);
    try { if (!statSync(join(dir, ".git")).isDirectory()) continue; } catch { continue; }
    const repo = await git(dir, "remote", "get-url", "origin").then(repoOf, () => null);
    if (!repo || seen.has(repo)) continue;
    seen.add(repo);
    out.push({ dir, repo });
  }
  return out;
}

let running: Promise<void> | null = null;
/** Scans every clone for branches named with these keys, one repo at a time. */
export function syncBranches(keys: string[], changed: () => void): Promise<void> {
  running ??= (async () => {
    const ks = [...new Set(keys)];
    if (!ks.length) return;
    for (const c of await clones()) {
      try {
        store[c.repo] = { at: new Date().toISOString(), branches: await scanRepo(c.dir, ks) };
        failedOnce.delete(c.repo);
      } catch (e) {
        if (!failedOnce.has(c.repo)) log(`branches: ${c.repo} failed, keeping the last read:`, (e as Error).message);
        failedOnce.add(c.repo);
      }
    }
    save("branches", store);
    changed();
  })().finally(() => { running = null; });
  return running;
}

/** A work item's branches across repos, from the cache. */
export function branchesFor(key: string, s: BranchStore = store): ItemBranch[] {
  return Object.values(s).flatMap((r) => r.branches.filter((b) => nameHasKey(b.name, key)))
    .map(({ repo, name, stages, lastCommitAt }) => ({ repo, name, stages, lastCommitAt }));
}

/** Tests only: replace the cache. */
export const setBranchStore = (s: BranchStore) => { store = s; };

export function startBranches(keys: () => string[], changed: () => void) {
  void syncBranches(keys(), changed);
  setInterval(() => void syncBranches(keys(), changed), BRANCH_EVERY_MS);
}
