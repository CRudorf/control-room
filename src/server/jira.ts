import { SETTINGS, tuning } from "./settings";
// The Jira feed: The user's In Progress issues and the status of every Jira key on the board, through
// jira.py (ADR 0001), on the Settings page's Jira interval. Transitions go through jira.py too.
import type { Issue } from "../shared/types";
import { JIRA, POLL } from "./config";
import { every } from "./every";
import { load, save } from "./db";
import { read, write, type Ctx } from "./runner";

let issues = new Map<string, Issue>((load<Issue[]>("jira") ?? []).map((i) => [i.key, i]));
let error: string | null = null;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function jira(...args: string[]): Promise<string> {
  try { return await read(["python3", JIRA, ...args]); }
  catch (e) { throw new Error((e as Error).message.replace(/^jira: /, "").slice(0, 300)); }
}

export const jiraIssues = () => issues;
export const jiraError = () => error;

let running: Promise<void> | null = null;
/** Refreshes the issues for these keys plus the user's In Progress ones. */
export function syncJira(keys: string[], changed: () => void): Promise<void> {
  running ??= (async () => {
    try {
      const r = JSON.parse(await jira("board", [...new Set(keys)].sort().join(",")));
      issues = new Map((r.issues as Issue[]).map((i) => [i.key, i]));
      save("jira", [...issues.values()]);
      error = null;
    } catch (e) {
      error = (e as Error).message;
      log("jira sync failed:", error);
    }
    changed();
  })().finally(() => { running = null; });
  return running;
}

export function startJira(keys: () => string[], changed: () => void) {
  if (!POLL) return;
  // The Jira login is global: a project with no Jira projects in its settings never calls it.
  const sync = () => { if (SETTINGS.jiraProjects?.length) void syncJira(keys(), changed); };
  sync();
  every(tuning.jiraMs, sync);
}

/** Moves an issue to a status, then refreshes it. Dev records it without moving anything. */
export async function transition(item: string | null, key: string, to: string, keys: string[], changed: () => void) {
  await moveIssue({ item, trigger: "suggested" }, key, to);
  await syncJira(keys, changed);
}

/** The Jira write alone: one action record, a dry run in dev. */
export const moveIssue = (ctx: Ctx, key: string, to: string) =>
  write(ctx, "jira-transition", `${key} → ${to}`, () => jira("transition", key, to).then(() => "moved"));

/** Assigns an issue to the user: one action record, a dry run in dev. */
export const assignToMe = (ctx: Ctx, key: string) =>
  write(ctx, "jira-assign", `${key} → me`, () => jira("assign", key, "me").then(() => "assigned"));
