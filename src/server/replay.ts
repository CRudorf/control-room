// Replays: does self-review catch the breaks it was taught? For each merged PR the user confirmed broke
// something, a review agent self-reviews the PR as it merged, with the lessons from before that break,
// and writes its findings beside the drafts. A finding in a file the break was in is a catch. The
// catch rate shows beside watch accuracy, so a prompt change that stops catching known breaks shows.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Shipped } from "../shared/types";
import { INSTALLED_STATE_DIR } from "./config";
import { load, save } from "./db";
import { startAgent } from "./handoff";
import { allLessons, current, TESTS_RULE, type Lesson } from "./lessons";
import { lessonFiles, shipped } from "./shipped";

/** Replays started at once, at most; each is a full review. */
export const MAX_REPLAYS = 2;

const DIR = join(INSTALLED_STATE_DIR, "replays");
mkdirSync(DIR, { recursive: true });
export const replayFile = (ref: string) => join(DIR, ref.replace(/[/#]/g, "__") + ".json");

type Finding = { path?: string; rank?: string; title?: string; body?: string };
/** `caught` is null until the user grades its candidates; no candidates is a miss. */
export type Replay = { ref: string; at: string; findings: number; caught: boolean | null; files: string[]; candidates: { path: string; title: string }[]; lesson: string | null };

/** A break's files: those its fix commits (or any later commits) rewrote, else the whole PR when reverted. */
export function breakFiles(w: Pick<Shipped, "rework" | "reverts" | "files">): string[] {
  const fixes = w.rework.filter((r) => r.fix && r.file).map((r) => r.file!);
  if (fixes.length) return [...new Set(fixes)];
  return w.reverts.length ? w.files : lessonFiles(w);
}

/** Findings that could be the break: in a file it was in, and not a nit. Being in the file doesn't make it the same bug. */
export function candidates<F extends Finding>(findings: F[], files: string[]): F[] {
  return findings.filter((f) => f.rank !== "nit" && !!f.path && files.some((x) => x === f.path || x.endsWith(`/${f.path}`) || f.path!.endsWith(`/${x}`)));
}

/** A replay's grade: a miss with no candidates, else the user's call on this run, null until then. */
export const grade = (cands: unknown[], g: { at: string; same: boolean } | undefined, at: string): boolean | null =>
  !cands.length ? false : g?.at === at ? g.same : null;

/** The user's call: is a candidate the bug that broke? It holds for this run only. */
export function gradeReplay(ref: string, at: string, same: boolean) {
  save("replay_grades", { ...(load<Record<string, { at: string; same: boolean }>>("replay_grades") ?? {}), [ref]: { at, same } });
}

/** The lessons the repo had before this break: its own (and any later) left out. */
export const lessonsBefore = (all: Lesson[], w: Pick<Shipped, "ref" | "repo" | "merged">) =>
  current(all.filter((l) => l.ref !== w.ref && l.at < w.merged), w.repo ?? w.ref.split("#")[0], 8, Date.parse(w.merged));

export function replayPrompt(w: Shipped, lessons: Lesson[]): string {
  const [repo, n] = w.ref.split("#");
  return `This is a replay, a test of self-review: review my PR ${w.ref} ("${w.title}") as it was the moment it merged, as if my reviewers hadn't seen it yet. Be the reviewers I'm about to get, including the review bots. Don't look at anything that happened after the merge: no later commits on the base, no issues, no Sentry, no PR comments.

Check out the PR's head in your worktree: \`git fetch origin pull/${n}/head && git checkout --detach FETCH_HEAD\`. Diff it against its base at the merge: \`git diff ${w.mergeSha ? `${w.mergeSha}^1` : "origin/HEAD"}...HEAD\`. Any finding gets verified by running code; drop what you can't confirm. ${TESTS_RULE}

${lessons.length ? `My merged PRs in this repo have broken things before. Check this one can't do the same, and make each that applies a finding:\n${lessons.map((l) => `- ${l.text} (${l.ref.split("/").pop()}${l.files?.length ? `, in ${l.files.join(", ")}` : ""})`).join("\n")}\n\n` : ""}Make no code changes, push nothing and post nothing. Write the findings as JSON to \`${replayFile(w.ref)}\`, replacing any earlier file:

{"pr": "${w.ref}", "sha": "<git rev-parse HEAD>", "at": "<now, ISO 8601>", "findings": [
  {"path": "src/x.ts", "line": 42, "rank": "blocking|important|should-do|nit", "title": "short label", "body": "what's wrong and the fix"}
]}

Paths are relative to the repo root of ${repo}.`;
}

/** Graded replays, newest first. */
export function replays(ws = shipped()): Replay[] {
  const grades = load<Record<string, { at: string; same: boolean }>>("replay_grades") ?? {};
  return ws.flatMap((w) => {
    const f = replayFile(w.ref);
    if (!existsSync(f)) return [];
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      const files = breakFiles(w);
      const at = String(d.at ?? "");
      const cands = candidates<Finding>(d.findings ?? [], files);
      return [{ ref: w.ref, at, findings: (d.findings ?? []).length, caught: grade(cands, grades[w.ref], at), files,
        candidates: cands.map((c) => ({ path: c.path!, title: c.title ?? c.body ?? "" })), lesson: w.lesson?.text ?? null }];
    } catch { return []; } // half-written: read it next time
  }).sort((a, b) => b.at.localeCompare(a.at));
}

/** Confirmed breaks with no replay yet, or all of them with `again`. */
export function dueReplays(ws: Shipped[], started: Record<string, string>, again: boolean): Shipped[] {
  return ws.filter((w) => w.verdict?.verdict === "caused" && (again || (!existsSync(replayFile(w.ref)) && !started[w.ref])));
}

/** How many confirmed breaks haven't been replayed. */
export const waitingReplays = () => dueReplays(shipped(), load<Record<string, string>>("replays_started") ?? {}, false).length;

/** Starts up to MAX_REPLAYS replays; the rest wait for the next press. */
export async function runReplays(again = false) {
  const started = load<Record<string, string>>("replays_started") ?? {};
  const due = dueReplays(shipped(), started, again).slice(0, MAX_REPLAYS);
  const out: string[] = [];
  for (const w of due) {
    const r = await startAgent({ item: `replay-${w.feature}`, repo: w.repo ?? w.ref.split("#")[0], pr: null, kind: "custom", prompt: replayPrompt(w, lessonsBefore(allLessons(), w)), edited: false, bare: true });
    if (!("dryRun" in r)) started[w.ref] = new Date().toISOString();
    out.push(r.name);
  }
  save("replays_started", started);
  return { started: out, waiting: waitingReplays() };
}
