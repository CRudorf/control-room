// The friction review: a default routine whose agent reads every session the control room has tied to a
// work item and suggests what would take friction out of a work item's whole workflow, written the way
// /improve-codebase-architecture writes its candidates. Before it starts, the control room writes the
// session index it reads: each item's sessions and transcripts, and how the item moved on the board.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Routine } from "../shared/types";
import { STATE_DIR } from "./config";
import { db } from "./db";
import { METRICS_FROM } from "./history";
import { friction, type Event } from "./metrics";
import { trackedSessions, type TrackedSession } from "./usage";

export const FRICTION_DIR = join(STATE_DIR, "friction");

export const FRICTION_PROMPT = `Review how work moves through the control room, from every agent session it has tied to a work item, and suggest improvements that take friction out of a work item's whole workflow: picking it up, planning, building, self-review, CI, review rounds, verification, merging and after.

Read GLOSSARY.md, PRODUCT.md and docs/adr first, so the suggestions use the board's terms and don't reopen settled decisions. Read the earlier reports too, so you don't repeat one, and say whether an earlier top recommendation shipped and whether its friction went away.

Then read the session index, and the transcripts it points to, newest and busiest items first; spawn sub-agents to read them in parallel. Look for where work stalls or repeats: the user explaining the same context again, correcting agents the same way in several sessions, asking an agent for status, doing by hand what a skill, hook or the board could do, agents retrying a step that keeps failing, permission prompts that keep coming back, hand-offs between agents that lose context, and long waits between steps. Count occurrences across sessions and items. Don't quote at length.

Write the report as one self-contained HTML file, the way /mattpocock-skills:improve-codebase-architecture writes its report: a card per candidate with Where (the workflow steps, and the files, skills, hooks or settings involved), Evidence (how many sessions and items, which ones), Problem, Solution, Benefits (what the user stops doing, and roughly how many turns or minutes a week that saves), a before and after of the flow, and a strength badge (Strong, Worth exploring or Speculative). End with a Top recommendation: which to do first and why. Also write the candidates as JSON: an array of {"title", "strength", "steps", "where", "evidence", "problem", "solution", "benefits"}.

Change no code and file nothing. When the report is written, give me its path and ask which candidate I'd like to explore.`;

/** Routines every control room starts with. A deleted one stays deleted. */
export const DEFAULT_ROUTINES: Routine[] = [
  { id: "friction", name: "Friction review", prompt: FRICTION_PROMPT, repos: ["control-room"], cadence: "weekly", weekday: 5, weekdaysOnly: true, when: "start", enabled: true, brief: "sessions" },
];

type ItemBrief = { item: string; repos: string[]; sessions: Omit<TrackedSession, "item">[]; board: Omit<Event, "item">[] };

/** Sessions grouped by work item, busiest first, each with how the item moved on the board. Pure. */
export function itemsOf(sessions: TrackedSession[], events: Event[]): ItemBrief[] {
  const items = new Map<string, ItemBrief>();
  for (const { item, ...s } of sessions) {
    const it = items.get(item) ?? { item, repos: [], sessions: [], board: [] };
    if (s.repo && !it.repos.includes(s.repo)) it.repos.push(s.repo);
    it.sessions.push(s);
    items.set(item, it);
  }
  // The board logs an item by its id, its key in lowercase.
  const byId = new Map([...items.values()].map((i) => [i.item.toLowerCase(), i]));
  for (const { item, ...e } of events) byId.get(item?.toLowerCase() ?? "")?.board.push(e);
  return [...items.values()].sort((a, b) => b.sessions.reduce((n, s) => n + s.turns, 0) - a.sessions.reduce((n, s) => n + s.turns, 0));
}

/** Earlier reports, oldest first. */
export const frictionReports = () => (existsSync(FRICTION_DIR) ? readdirSync(FRICTION_DIR).filter((f) => f.endsWith("-report.html")).sort() : []);

/** The newest report: its path and when it was written. */
export function latestReport() {
  const f = frictionReports().at(-1);
  if (!f) return null;
  const path = join(FRICTION_DIR, f);
  return { path, at: statSync(path).mtime.toISOString() };
}

/** Writes the session index for a run and returns what to add to the prompt: where to read and write. */
export function writeBrief(now = new Date()): string {
  mkdirSync(FRICTION_DIR, { recursive: true });
  const day = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const briefPath = join(FRICTION_DIR, `${day}-sessions.json`);
  const events = db.query<Event, [string]>("SELECT at, item, kind, lane, step, detail FROM item_events WHERE dry_run = 0 AND at >= ? ORDER BY at").all(METRICS_FROM);
  const actions = db.query<{ action: string; trigger: string; result: string; n: number }, [string]>(
    "SELECT action, trigger, result, count(*) AS n FROM action_records WHERE at >= ? AND dry_run = 0 GROUP BY action, trigger, result ORDER BY n DESC").all(METRICS_FROM);
  const items = itemsOf(trackedSessions(METRICS_FROM), events);
  writeFileSync(briefPath, JSON.stringify({
    from: METRICS_FROM, written: now.toISOString(),
    notes: [
      "items: each work item the control room tied sessions to, busiest first. sessions: its Claude Code sessions, when they ran, how many model turns, and the transcript (JSONL; the user's turns are type \"user\" with a string content). board: how the item moved: arrive, move (to a lane, and a Next step) and leave.",
      "friction: by week, from the board's event log. myTurnHours: how long each stretch on My turn lasted before the item moved on.",
      "actions: what the user did through the control room, by action, what started it and how it went.",
    ],
    items, friction: friction(events, METRICS_FROM), actions,
  }, null, 2));
  return `\n\nFor this run:\n- The session index: "${briefPath}"\n- Earlier reports: "${FRICTION_DIR}" (*-report.html, *-candidates.json)\n- Write the report to "${join(FRICTION_DIR, `${day}-report.html`)}" and the candidates to "${join(FRICTION_DIR, `${day}-candidates.json`)}".`;
}
