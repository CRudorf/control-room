// Routines: prompts the control room starts on its own, daily or weekly, in each of their repos. One runs
// at a set local time, or when the user starts work: the first time that day they're at the machine
// (keyboard or mouse in the last two minutes, after the hour on the Settings page, 5am by default). A routine with no prompt runs /signal-to-pr bare,
// which triages the repo's live errors into a menu. Each run is once per day or week; a failed start
// tries again half an hour later. Every control room starts with the weekly friction review (friction.ts).
// A run starts on the first machine from Settings that's ready (machines.ts), else on this Mac.
import { execFileSync } from "node:child_process";
import { DEV } from "./config";
import { load, save } from "./db";
import { DEFAULT_ROUTINES, writeBrief } from "./friction";
import { startAgent } from "./handoff";
import { isDev, note } from "./runner";
import { machines, syncTo, unready } from "./machines";
import { tuning } from "./settings";
import { weekOf } from "../shared/week";
import type { Routine, RoutineRun } from "../shared/types";

const CHECK_MS = 60_000;
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
  if (r.when === "start") { if (!active || now.getHours() < tuning.workFrom()) return false; }
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

/** The routines, with any default not yet added once. A deleted default stays deleted. */
export function routines(): Routine[] {
  const have = load<Routine[]>("routines") ?? [], seeded = load<string[]>("routines_seeded") ?? [];
  const fresh = DEFAULT_ROUTINES.filter((d) => !seeded.includes(d.id) && !have.some((r) => r.id === d.id));
  if (!fresh.length) return have;
  save("routines", [...have, ...fresh]);
  save("routines_seeded", [...seeded, ...fresh.map((d) => d.id)]);
  return [...have, ...fresh];
}
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
    weekdaysOnly: !!r.weekdaysOnly, when: r.when, enabled: !!r.enabled, ...(r.brief === "sessions" ? { brief: r.brief } : {}), ...(r.runOn === "local" ? { runOn: r.runOn } : {}) };
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

/** A routine that runs only on this Mac: set so, or one whose brief is this Mac's own sessions. */
export const onlyHere = (r: Pick<Routine, "runOn" | "brief">) => r.runOn === "local" || r.brief === "sessions";

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
  let prompt = r.prompt || "/signal-to-pr";
  try { if (r.brief === "sessions") prompt += writeBrief(); }
  catch (e) { errors.push(`the session index: ${(e as Error).message}`); }
  for (const repo of errors.length ? [] : r.repos) {
    const start = (machine: string | null) => startAgent({ item: `routine-${r.id}-${repo}`, repo, pr: null, kind: "custom", prompt, edited: false, machine });
    // The first machine from Settings that's ready takes it; any failure there falls back to this Mac, and the run says why.
    const why: string[] = [];
    if (!onlyHere(r)) for (const m of machines()) {
      const no = await unready(m, repo);
      if (no) { why.push(no); continue; }
      try {
        if (!isDev()) await syncTo(m);
        const a = await start(m.name);
        agents.push({ repo, name: a.name, dryRun: "dryRun" in a, machine: m.name });
        break;
      } catch (e) { why.push(`${m.name}: ${(e as Error).message}`); }
    }
    if (agents.some((a) => a.repo === repo)) continue;
    try {
      const a = await start(null);
      agents.push({ repo, name: a.name, dryRun: "dryRun" in a, machine: null, ...(why.length ? { fellBack: why.join("; ") } : {}) });
    } catch (e) { errors.push(`${repo}: ${(e as Error).message}`); }
  }
  const run: RoutineRun = { period, at, trigger, agents, error: errors.length ? errors.join("; ") : null };
  save("routine_runs", { ...routineRuns(), [r.id]: run });
  note({ item: null, trigger: "routine" }, "routine", r.name, run.error ? `failed: ${run.error}` : `started ${agents.map((a) => `${a.name}${a.machine ? ` on ${a.machine}` : ""}`).join(", ")}`, { at, detail: run });
  return run;
}

/** Checks every minute for routines that are due. A dev server runs none. */
export function startRoutines() {
  if (DEV) return;
  const check = () => {
    if (!tuning.scheduled()) return;
    const due = routines().filter((r) => isDue(r, new Date(), routineRuns()[r.id], r.when === "start" && (idleSeconds() ?? Infinity) < ACTIVE_S));
    for (const r of due) void runRoutine(r.id, "schedule").catch((e) => console.error(new Date().toISOString(), `routine ${r.id} failed:`, (e as Error).message));
  };
  check();
  setInterval(check, CHECK_MS);
}
