// The GitHub Issues tracker: a project's open issues as board issues and suggestions, through gh.
// Its setup refuses a repo that names private work, because its issues must not.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Issue, Suggestion } from "../shared/types";
import { load, save } from "./db";
import { isDev, note, read, write, type Ctx } from "./runner";
import { KNOWN_PROJECTS, SETTINGS, SETTINGS_PATH, trackerPrefix } from "./settings";
import { ownerOfRemote, PROJECT, PROJECTS_PATH, projectRepos, repoInProject, repoPath } from "./repos";

type Raw = Omit<Suggestion, "verdict" | "of" | "reason" | "facts" | "boost">;
export type GhIssue = { number: number; title: string; url: string; updatedAt: string; labels: { name: string }[]; assignees: { login: string }[] };

export const trackerKind = (): "jira" | "github" | null => SETTINGS.tracker?.kind ?? (SETTINGS.jiraProjects?.length ? "jira" : null);
const repos = () => SETTINGS.tracker?.kind === "github" ? SETTINGS.tracker.repos : [];

export const issueKey = (repo: string, n: number) => `${trackerPrefix(repo)}-${n}`;

/** The repo and number a key names, when it is one of this project's GitHub issues. */
export function repoOfKey(key: string, list = repos()): { repo: string; number: number } | null {
  const m = key.toUpperCase().match(/^([A-Z0-9]+)-(\d+)$/);
  const repo = m && list.find((r) => trackerPrefix(r) === m[1]);
  return repo ? { repo, number: Number(m![2]) } : null;
}

/** The key of a GitHub issue link in a tracked repo, else null. */
export function keyOfUrl(url: string, list = repos()): string | null {
  const m = url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/);
  const repo = m && list.find((r) => r.toLowerCase() === m[1].toLowerCase());
  return repo ? issueKey(repo, Number(m![2])) : null;
}

export const issueUrl = (key: string, list = repos()) => {
  const r = repoOfKey(key, list);
  return r ? `https://github.com/${r.repo}/issues/${r.number}` : null;
};

export function toIssue(repo: string, i: GhIssue, me: string): Issue {
  const mine = i.assignees.some((a) => a.login.toLowerCase() === me.toLowerCase());
  return { key: issueKey(repo, i.number), summary: i.title, status: "Open", category: mine ? "indeterminate" : "new", mine, updated: i.updatedAt, url: i.url, transitions: [] };
}

export function toSuggestion(repo: string, i: GhIssue, me: string, rank: number): Raw {
  const mine = i.assignees.some((a) => a.login.toLowerCase() === me.toLowerCase());
  return { key: issueKey(repo, i.number), summary: i.title, source: mine ? "a" : "c", status: "Open", priority: null, assignee: mine ? "me" : null,
    labels: i.labels.map((l) => l.name), parent: null, links: [], updated: i.updatedAt, rank, url: i.url, tracker: "github" };
}

let issues = new Map<string, Issue>((load<Issue[]>("gh_issues") ?? []).map((i) => [i.key, i]));
export const trackerIssues = () => issues;

/** Reads every tracked repo. One repo failing throws, and the last good list stays. */
export async function syncTracker(): Promise<Raw[]> {
  const list = repos();
  if (!list.length) { issues = new Map(); return []; }
  const me = (await read(["gh", "api", "user", "--jq", ".login"])).trim();
  const all: Issue[] = [], raw: Raw[] = [];
  for (const repo of list) {
    const got = JSON.parse(await read(["gh", "issue", "list", "-R", repo, "--state", "open", "--limit", "30", "--json", "number,title,url,updatedAt,labels,assignees"])) as GhIssue[];
    got.forEach((i, n) => { all.push(toIssue(repo, i, me)); raw.push(toSuggestion(repo, i, me, n)); });
  }
  issues = new Map(all.map((i) => [i.key, i]));
  save("gh_issues", all);
  return raw;
}

export function assignIssue(ctx: Ctx, key: string) {
  const r = repoOfKey(key);
  if (!r) throw new Error(`${key} isn't a tracked issue`);
  return write(ctx, "issue-assign", `${key} → me`, ["gh", "issue", "edit", String(r.number), "-R", r.repo, "--add-assignee", "@me"]);
}

/** The private words: the same list publish-check.sh and issue-guard.py use. No list means nothing can be cleared. */
export function privateWords(path = join(dirname(PROJECTS_PATH), "public-blocklist.txt")): string[] | null {
  if (!existsSync(path)) return null;
  const l = readFileSync(path, "utf8").split("\n").map((x) => x.trim().toLowerCase()).filter((x) => x && !x.startsWith("#"));
  return l.length ? l : null;
}

/** Why a repo can't be a tracker, or null. It has to belong to this project and name nothing private. */
export function refusal(repo: string, words: string[] | null, inProject = repoInProject): string | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return `${repo} isn't owner/name`;
  if (!words) return "no private word list, so nothing can be checked (~/.config/control-room/public-blocklist.txt)";
  if (words.some((w) => repo.toLowerCase().includes(w))) return "that repo names private work";
  if (!inProject(repo)) return "that repo isn't in this project";
  return null;
}

function publicRepo(): string | null {
  try {
    const p = JSON.parse(readFileSync(PROJECTS_PATH, "utf8")).public;
    return p?.project === PROJECT ? p.repo ?? null : null;
  } catch { return null; }
}

function slugOf(name: string): string | null {
  try {
    const url = readFileSync(join(repoPath(name), ".git", "config"), "utf8").match(/\[remote "origin"\][^[]*?url = (.+)/)?.[1]?.trim();
    const owner = url && ownerOfRemote(url);
    return owner ? `${owner}/${name}` : null;
  } catch { return null; }
}

/** What setup offers: this project's repos that pass the check, the public repo standing in for a private clone of it. */
export function trackerOptions(): string[] {
  const words = privateWords();
  const pub = publicRepo();
  const pubName = pub?.split("/").pop();
  const slugs = projectRepos().map((n) => (n === pubName ? pub! : slugOf(n))).filter((s): s is string => !!s);
  return [...new Set([...(pub ? [pub] : []), ...slugs])].filter((r) => !refusal(r, words)).sort();
}

export const trackerState = () => ({ kind: trackerKind(), repos: repos(), options: trackerOptions(), error: privateWords() ? null : refusal("a/b", null) });

/** Sets GitHub Issues as the tracker after reading each repo. Dev applies it until restart and leaves the file alone. */
export async function setupTracker(list: string[], ctx: Ctx = { item: null, trigger: "tracker setup" }) {
  if (!list.length) throw new Error("pick at least one repo");
  if (SETTINGS.jiraProjects?.length) throw new Error("this project already uses Jira");
  const words = privateWords();
  for (const r of list) {
    const why = refusal(r, words);
    if (why) throw new Error(`${r}: ${why}`);
    try { await read(["gh", "issue", "list", "-R", r, "--limit", "1", "--json", "number"]); }
    catch (e) { throw new Error(`can't read issues on ${r}: ${(e as Error).message.slice(0, 160)}`); }
  }
  SETTINGS.tracker = { kind: "github", repos: list };
  for (const r of list) if (!KNOWN_PROJECTS.includes(trackerPrefix(r))) KNOWN_PROJECTS.push(trackerPrefix(r));
  if (isDev()) { note(ctx, "tracker-setup", list.join(", "), "dry run"); return { kind: "github", repos: list, dryRun: true }; }
  const onDisk = existsSync(SETTINGS_PATH) ? JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) : {};
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify({ ...onDisk, tracker: SETTINGS.tracker }, null, 2) + "\n");
  note(ctx, "tracker-setup", list.join(", "), "saved");
  return { kind: "github", repos: list };
}
