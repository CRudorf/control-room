import { issueUrl, keyOfUrl, repoOfKey } from "./tracker";
import { CLAUDE_DIR } from "./repos";
// Starting work from the Start box: a signal (a Jira issue, a Sentry issue or a PostHog replay)
// runs the signal-to-pr skill in a new herdr tab; anything else is a task, sent to Claude as written.
import { projectRepos, tuned } from "./repos";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load, save } from "./db";
import { startAgent } from "./handoff";
import { prFacts } from "./history";
import { trackerKey, errorKey } from "./workitems";
import { addRun } from "./runs";

export type SignalKind = "github" | "jira" | "sentry" | "posthog" | "task";
export type Signal = { kind: SignalKind; key: string; text: string };

const SKILL = join(CLAUDE_DIR, "skills", "signal-to-pr", "SKILL.md");

/** A task in the user's words. Its key is a Jira or Sentry key it mentions, so it joins that work item, else its first words. */
function taskOf(text: string): Signal {
  const key = errorKey(text) ?? trackerKey(text) ?? `task-${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 4).join("-")}`;
  return { kind: "task", key, text };
}

/** What was typed: a signal (one key or link) or a task (anything else), and the key its work item goes by on the board. */
export function parseSignal(raw: string): Signal | null {
  const text = raw.trim();
  if (!text) return null;
  if (/\s/.test(text)) return taskOf(text);
  const gh = keyOfUrl(text) ?? (repoOfKey(text) ? text.toUpperCase() : null);
  if (gh) return { kind: "github", key: gh, text: issueUrl(gh)! };
  const sentryShort = errorKey(text);
  if (sentryShort) return { kind: "sentry", key: sentryShort, text };
  const sentryUrl = text.match(/sentry\.io\/(?:organizations\/[^/]+\/)?issues\/(\d+)/);
  if (sentryUrl) return { kind: "sentry", key: `SENTRY-${sentryUrl[1]}`, text };
  const replay = text.match(/posthog\.com\/.*replay\/([\w-]+)/i) ?? text.match(/[?&]sessionRecordingId=([\w-]+)/);
  if (replay) return { kind: "posthog", key: `replay-${replay[1].slice(0, 8)}`, text };
  const jira = trackerKey(text);
  if (jira) return { kind: "jira", key: jira, text };
  return taskOf(text);
}

/** Which repo a signal's project has gone to before: Jira project or Sentry project, by the user's PR history. */
export function reposFromHistory(sig: Signal, facts: { feature: string; repo: string; created: string }[]): string[] {
  const prefix = trackerKey(sig.key) === sig.key ? `${sig.key.split("-")[0]}-` : errorKey(sig.key) ? sig.key.split("-").slice(0, 3).join("-") + "-" : null;
  if (!prefix) return [];
  const score = new Map<string, number>();
  for (const f of facts) if (f.feature.startsWith(prefix)) score.set(f.repo.split("/").pop()!, (score.get(f.repo.split("/").pop()!) ?? 0) + 1);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

/** Clones under ~/Projects (worktrees, whose .git is a file, left out); profiled ones first. */
function clones(): { repo: string; profiled: boolean }[] {
  return projectRepos()
    .map((repo) => ({ repo, profiled: tuned(repo, "signal-to-pr") }))
    .sort((a, b) => Number(b.profiled) - Number(a.profiled) || a.repo.localeCompare(b.repo));
}

/** The Start box's suggestion for a signal: the repo to use, the rest to pick from, and whether signal-to-pr is installed. */
export function suggest(raw: string) {
  const sig = parseSignal(raw);
  const all = clones();
  if (!sig) {
    // Nothing typed: the box offers signal-to-pr's triage of a repo's live errors and slow endpoints (from its tuning).
    const used = load<Record<string, string>>("start_last_repo") ?? {};
    const last = used.triage ?? used.sentry;
    const repo = last && all.some((c) => c.repo === last) ? last : all.find((c) => c.profiled)?.repo ?? null;
    return { signal: null, repo, repos: all, skill: existsSync(SKILL) };
  }
  const last = load<Record<string, string>>("start_last_repo")?.[sig.kind] ?? null;
  const known = new Set(all.map((c) => c.repo));
  const hist = reposFromHistory(sig, prFacts()).filter((r) => known.has(r));
  const repo = hist[0] ?? (last && known.has(last) ? last : null);
  const why = hist[0] ? `where your ${sig.key.split("-")[0]} PRs go` : repo ? `last used for ${sig.kind}` : null;
  return { signal: sig, repo, why, repos: all, skill: existsSync(SKILL) };
}

/** A task as written, and when the user said what done looks like, that too, with the checks to show for it. */
export function taskPrompt(text: string, done = ""): string {
  if (!done.trim()) return text;
  return `${text}\n\nDone when: ${done.trim()}\n\nFinish by showing me each check you ran against that, the command and its exit code.`;
}

export function prompt(sig: Signal, unattended: boolean, done = "", context = "", skill = existsSync(SKILL), video = false): string {
  if (sig.kind === "task") return taskPrompt(sig.text, done);
  const branch = sig.kind === "github" ? `\n\nName the branch after ${sig.key}, so it joins this work item.` : "";
  const ctx = (context.trim() ? `\n\nContext: ${context.trim()}` : "") + branch;
  if (skill) return `/signal-to-pr ${sig.text}${unattended ? " unattended" : ""}${video ? " video" : ""}${ctx}`;
  const what = { github: "GitHub issue", jira: "Jira issue", sentry: "Sentry issue", posthog: "PostHog session replay" }[sig.kind];
  return `Start work from this ${what}: ${sig.text}\n\nRead it first (jira skill for Jira, the Sentry tools for Sentry). Find the root cause in this repo, cut a branch off the latest main named after ${sig.key}, fix it with tests, and stop before pushing: show me the root cause and the change, and wait for my go-ahead.${ctx}`;
}

/** Opens a herdr tab on the signal. The tab label carries the key, so it joins its work item at once. */
export async function startFromSignal(raw: string, repo: string, unattended: boolean, done = "", context = "", video = false) {
  const sig = parseSignal(raw);
  if (!sig) throw new Error("nothing to start");
  if (sig.kind === "task" && !done.trim()) throw new Error("say what done looks like");
  const r = await startAgent({ item: sig.key, repo, pr: null, kind: "custom", prompt: prompt(sig, unattended, done, context, existsSync(SKILL), video), edited: false });
  // An unattended run hands back for review when its agent finishes.
  if (unattended && sig.kind !== "task") addRun(sig.key, r.name);
  save("start_last_repo", { ...(load<Record<string, string>>("start_last_repo") ?? {}), [sig.kind]: repo });
  return { ...r, key: sig.key };
}

/** signal-to-pr with no signal: it triages the repo's live errors and slow endpoints into a menu for the user to pick from. */
export async function startTriage(repo: string) {
  if (!existsSync(SKILL)) throw new Error("signal-to-pr isn't in ~/.claude/skills");
  const key = `triage-${repo}`;
  const r = await startAgent({ item: key, repo, pr: null, kind: "custom", prompt: "/signal-to-pr", edited: false });
  save("start_last_repo", { ...(load<Record<string, string>>("start_last_repo") ?? {}), triage: repo });
  return { ...r, key };
}
