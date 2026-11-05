// Branches: a work item's remote branches, named with its Jira key (GLOSSARY: Branch), in every full
// clone under ~/Projects whose origin is in the settings org. Every few minutes (polling only, Settings) it
// fetches each repo once, in turn, and records which matching branches are in each stage of the
// project's flow. All commands go through the runner. A failure keeps the last cache. GitHub's merged
// PRs count as well, so a merge shows within minutes and a failed fetch can't hide it.
import { projectRepos, repoPath } from "./repos";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ItemBranch } from "../shared/types";
import { load, save } from "./db";
import { read } from "./runner";
import { every } from "./every";
import { SETTINGS, tuning } from "./settings";

/** A fetch of a large repo takes minutes. Every other git command stays on the short limit. */
const FETCH_TIMEOUT_MS = 5 * 60_000;
const MERGED_KEPT = 300;
const flowStages = () => SETTINGS.flow?.stages ?? [];
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** The cache: per repo (owner/name), the branches that matched a key, and when it was read. */
export type BranchStore = Record<string, { at: string; branches: (ItemBranch & { sha: string })[] }>;
let store: BranchStore = load<BranchStore>("branches") ?? {};
/** A PR merged into the last stage, as GitHub reports it. */
export type MergedPr = { repo: string; number: number; head: string; at: string };
let merged: MergedPr[] = load<MergedPr[]>("branches_merged") ?? [];
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
  await read(["git", "-C", dir, "fetch", "--prune", "-q", "origin"], { timeoutMs: FETCH_TIMEOUT_MS });
  const refs = (await git(dir, "for-each-ref", "--format=%(refname:short)|%(objectname)|%(committerdate:iso-strict)", "refs/remotes/origin"))
    .split("\n").filter(Boolean).map((l) => l.split("|")).map(([ref, sha, at]) => ({ name: ref.replace(/^origin\//, ""), sha, at }));
  const have = new Set(refs.map((r) => r.name));
  const repo = repoOf(await git(dir, "remote", "get-url", "origin")) ?? dir;
  const out: (ItemBranch & { sha: string })[] = [];
  for (const r of refs) {
    if (r.name === "HEAD" || !keys.some((k) => nameHasKey(r.name, k))) continue;
    const stages = await Promise.all(flowStages().map(async (b) => ({ name: b, in: have.has(b) ? await ancestor(dir, r.name, b) : null })));
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

/**
 * Adds what GitHub knows to the branches a scan read, so a merge counts at once, even if the fetch failed.
 * A merged PR puts its branch in the last stage, unless the branch has commits newer than the merge.
 * The merged PR of a deleted branch counts as a branch, unless a live branch has newer commits.
 */
export function withMerged(bs: ItemBranch[], prs: MergedPr[], stages: string[] = flowStages()): ItemBranch[] {
  if (!stages.length) return bs;
  const last = stages[stages.length - 1];
  const time = (s: string) => Date.parse(s) || 0;
  const out = bs.map((b) => {
    const hit = prs.some((p) => p.repo === b.repo && p.head === b.name && time(p.at) >= time(b.lastCommitAt));
    return hit ? { ...b, stages: b.stages.map((x) => (x.name === last ? { ...x, in: true } : x)) } : b;
  });
  const newest = Math.max(0, ...bs.map((b) => time(b.lastCommitAt)));
  for (const p of prs) {
    if (time(p.at) < newest || out.some((b) => b.repo === p.repo && b.name === p.head)) continue;
    out.push({ repo: p.repo, name: p.head, lastCommitAt: p.at, stages: stages.map((name) => ({ name, in: name === last ? true : null })) });
  }
  return out;
}

/** A work item's branches across repos: the cache, then GitHub's merged PRs. */
export function branchesFor(key: string, s: BranchStore = store, m: MergedPr[] = merged): ItemBranch[] {
  const scanned = Object.values(s).flatMap((r) => r.branches.filter((b) => nameHasKey(b.name, key))
    .map(({ repo, name, stages, lastCommitAt }) => ({ repo, name, stages, lastCommitAt, readAt: r.at })));
  return withMerged(scanned, m.filter((p) => nameHasKey(p.head, key)));
}

/** Asks GitHub for the latest PRs merged into the last stage, one call per repo. A failure keeps the last read. */
export async function syncMerged(changed: () => void): Promise<void> {
  const last = flowStages().at(-1);
  if (!last) return;
  const seen = new Map(merged.map((p) => [`${p.repo}#${p.number}`, p]));
  const before = seen.size;
  for (const c of await clones()) {
    try {
      const raw = await read(["gh", "pr", "list", "-R", c.repo, "--base", last, "--state", "merged", "--limit", "50", "--json", "number,headRefName,mergedAt"]);
      for (const p of JSON.parse(raw) as { number: number; headRefName: string; mergedAt: string }[])
        seen.set(`${c.repo}#${p.number}`, { repo: c.repo, number: p.number, head: p.headRefName, at: p.mergedAt });
    } catch (e) {
      if (!failedOnce.has(`merged ${c.repo}`)) log(`branches: merged PRs of ${c.repo} failed, keeping the last read:`, (e as Error).message);
      failedOnce.add(`merged ${c.repo}`);
    }
  }
  if (seen.size === before) return;
  merged = [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MERGED_KEPT);
  save("branches_merged", merged);
  changed();
}

/** Tests only: replace the cache. */
export const setBranchStore = (s: BranchStore) => { store = s; };

export function startBranches(keys: () => string[], changed: () => void) {
  void syncBranches(keys(), changed);
  every(tuning.branchesMs, () => void syncBranches(keys(), changed));
  void syncMerged(changed);
  every(tuning.mergedMs, () => void syncMerged(changed));
}
