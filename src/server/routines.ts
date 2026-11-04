// Routines: prompts the control room starts on its own, daily or weekly, in each of their repos. One runs
// at a set local time, or when the user starts work: the first time that day they're at the machine
// (keyboard or mouse in the last two minutes, after 5am). A routine with no prompt runs /signal-to-pr bare,
// which triages the repo's live errors into a menu. Each run is once per day or week; a failed start
// tries again half an hour later.
import { execFileSync } from "node:child_process";
import { DEV } from "./config";
import { load, save } from "./db";
import { startAgent } from "./handoff";
import { note } from "./runner";
import { weekOf } from "../shared/week";
import type { Routine, RoutineRun } from "../shared/types";

const CHECK_MS = 60_000;
/** Before this hour, being at the machine isn't starting work. */
export const START_HOUR = 5;
/** Seconds since the last keyboard or mouse input that still count as at the machine. */
const ACTIVE_S = 120;
const RETRY_MS = 30 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The day or week a run belongs to: one run each. */
export const periodOf = (r: Pick<Routine, "cadence">, now: Date) => (r.cadence === "daily" ? localDay(now) : weekOf(now.toISOString()));

/** Whether a routine should start now. `active`: the user is at the machine. */
export function isDue(r: Routine, now: Date, last: RoutineRun | undefined, active: boolean): boolean {
  if (!r.enabled) return false;
  const day = now.getDay();
  if ((r.weekdaysOnly || r.cadence === "weekly") && day % 6 === 0) return false;
  // Weekly: on its weekday, or the first weekday after it if the control room was off.
  if (r.cadence === "weekly" && day < r.weekday) return false;
  if (r.when === "start") { if (!active || now.getHours() < START_HOUR) return false; }
  else if (`${pad(now.getHours())}:${pad(now.getMinutes())}` < r.when) return false;
  if (last?.period !== periodOf(r, now)) return true;
  return !!last.error && now.getTime() - Date.parse(last.at) >= RETRY_MS;
}

/** Seconds since the last keyboard or mouse input, from macOS; null where it can't be read. */
export function idleSeconds(): number | null {
  try {
    const out = execFileSync("ioreg", ["-c", "IOHIDSystem"], { encoding: "utf8", timeout: 5000 });
    const ns = out.match(/"HIDIdleTime" = (\d+)/)?.[1];
    return ns ? Math.floor(Number(ns) / 1e9) : null;
  } catch { return null; }
}

export const routines = () => load<Routine[]>("routines") ?? [];
export const routineRuns = () => load<Record<string, RoutineRun>>("routine_runs") ?? {};

const ID = /^[a-z0-9-]{1,40}$/;

/** Adds or replaces a routine, after checking its fields. */
export function saveRoutine(r: Routine): Routine {
  if (!ID.test(r.id)) throw new Error("the id is lowercase letters, digits and dashes");
  if (!r.name.trim()) throw new Error("name it");
  if (!r.repos.length) throw new Error("pick at least one repo");
  if (r.when !== "start" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.when)) throw new Error("the time is HH:MM");
  if (r.cadence === "weekly" && !(r.weekday >= 1 && r.weekday <= 5)) throw new Error("the weekday is Monday to Friday");
  const clean: Routine = { id: r.id, name: r.name.trim(), prompt: r.prompt.trim(), repos: [...new Set(r.repos)], cadence: r.cadence, weekday: r.weekday,
    weekdaysOnly: !!r.weekdaysOnly, when: r.when, enabled: !!r.enabled };
  save("routines", [...routines().filter((x) => x.id !== r.id), clean]);
  return clean;
}

export function deleteRoutine(id: string) {
  save("routines", routines().filter((x) => x.id !== id));
  const runs = routineRuns();
  delete runs[id];
  save("routine_runs", runs);
}

const running = new Set<string>();

/** Starts a routine's agent in each of its repos and records the run. */
export async function runRoutine(id: string, trigger: "schedule" | "routines page") {
  const r = routines().find((x) => x.id === id);
  if (!r) throw new Error("no such routine");
  if (running.has(id)) throw new Error("it's starting already");
  running.add(id);
  try { return await startRun(r, trigger); } finally { running.delete(id); }
}

async function startRun(r: Routine, trigger: string) {
  const at = new Date().toISOString(), period = periodOf(r, new Date());
  const agents: RoutineRun["agents"] = [], errors: string[] = [];
  for (const repo of r.repos) {
    try {
      const a = await startAgent({ item: `routine-${r.id}-${repo}`, repo, pr: null, kind: "custom", prompt: r.prompt || "/signal-to-pr", edited: false });
      agents.push({ repo, name: a.name, dryRun: "dryRun" in a });
    } catch (e) { errors.push(`${repo}: ${(e as Error).message}`); }
  }
  const run: RoutineRun = { period, at, trigger, agents, error: errors.length ? errors.join("; ") : null };
  save("routine_runs", { ...routineRuns(), [r.id]: run });
  note({ item: null, trigger: "routine" }, "routine", r.name, run.error ? `failed: ${run.error}` : `started ${agents.map((a) => a.name).join(", ")}`, { at, detail: run });
  return run;
}

/** Checks every minute for routines that are due. A dev server runs none. */
export function startRoutines() {
  if (DEV) return;
  const check = () => {
    const due = routines().filter((r) => isDue(r, new Date(), routineRuns()[r.id], r.when === "start" && (idleSeconds() ?? Infinity) < ACTIVE_S));
    for (const r of due) void runRoutine(r.id, "schedule").catch((e) => console.error(new Date().toISOString(), `routine ${r.id} failed:`, (e as Error).message));
  };
  check();
  setInterval(check, CHECK_MS);
}
