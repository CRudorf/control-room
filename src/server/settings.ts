// Where this project's work lives, from ~/.config/control-room/projects/<project>.json, so none of it is in the repo:
//   {"org": "acme", "sentryOrg": "acme", "jiraProjects": ["ABC", "XYZ"],
//    "jiraSuggestSprints": ["Next up"], "jiraSuggestLabel": "cleanup",
//    "polling": {"detectMin": 2}, "agents": {"reviewRounds": 3}, "schedule": {"loopFrom": 9}, "prs": {"botPattern": "bot|^wiz-"}}
// jiraSuggestSprints are the container sprints Suggestions read after the active sprint
// (none by default); jiraSuggestLabel marks a backlog label to suggest (none by default).
// polling, agents and schedule hold the tuning in KNOBS. The Settings page edits all of it, and a
// save changes SETTINGS in place, so readers see it without a restart.
// prs.py, jira.py and review-handoff.sh read the same file. Every key is optional.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PROJECT } from "./repos";

import type { ParkRule } from "./parkrules";

/** A project's delivery flow: the branches work moves through, last one means shipped, and the issue statuses of a person's acceptance step. */
export type Flow = { stages?: string[]; testingStatus?: string; approvedStatus?: string; who?: string; copySuffix?: string; parkRules?: ParkRule[] };

export type KnobSection = "polling" | "agents" | "schedule";

export type Settings = {
  flow?: Flow; aws?: boolean; awsMfaScript?: string; pickupHint?: string; org?: string; sentryOrg?: string;
  jiraProjects?: string[]; jiraSuggestSprints?: string[]; jiraSuggestLabel?: string; tracker?: { kind: "github"; repos: string[] };
  prs?: { botPattern?: string };
  machines?: Machine[];
} & { [S in KnobSection]?: Record<string, number> };

/** Another machine that runs agents: its own herdr, reached over ssh. Routines start there first and fall back to this one. */
export type Machine = { name: string; ssh: string; reposRoot?: string; enabled?: boolean };

export const SETTINGS_PATH = process.env.CR_SETTINGS ?? join(homedir(), ".config", "control-room", "projects", `${PROJECT ?? "none"}.json`);

function read(): Settings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try { return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")); } catch { return {}; }
}

export const SETTINGS = read();

/** A GitHub repo's prefix in work item keys: CONTROLROOM-12 is issue 12 of owner/control-room. */
export const trackerPrefix = (repo: string) => repo.split("/").pop()!.toUpperCase().replace(/[^A-Z0-9]/g, "");

const knownProjects = () => [...(SETTINGS.jiraProjects ?? []), ...(SETTINGS.tracker?.repos ?? []).map(trackerPrefix)];

/** The key prefixes that name an issue here. Tracker setup adds to it while running, and a save rebuilds it in place. */
export const KNOWN_PROJECTS: string[] = knownProjects();

/** A number the Settings page tunes: where it's kept, what it means, its default and its bounds. */
export type Knob = { section: KnobSection; key: string; label: string; help: string; unit: string; def: number; min: number; max: number };

export const KNOBS: Knob[] = [
  { section: "polling", key: "detectMin", label: "GitHub check", help: "One cheap query for what changed on your PRs and review requests.", unit: "min", def: 2, min: 1, max: 60 },
  { section: "polling", key: "reconcileMin", label: "GitHub full check", help: "Triages every open PR and review request again from scratch.", unit: "min", def: 20, min: 5, max: 240 },
  { section: "polling", key: "jiraMin", label: "Jira", help: "Issue statuses, and the Jira issues Suggestions offers.", unit: "min", def: 10, min: 2, max: 240 },
  { section: "polling", key: "branchesMin", label: "Branches", help: "Fetches each clone to see which stage a work item's branches have reached.", unit: "min", def: 20, min: 5, max: 240 },
  { section: "polling", key: "mergedMin", label: "Merged PRs", help: "Asks GitHub for PRs merged into the last stage, one call per repo.", unit: "min", def: 2, min: 1, max: 60 },
  { section: "polling", key: "herdrSec", label: "herdr", help: "Reads every session again, on top of herdr's live events.", unit: "s", def: 30, min: 10, max: 600 },
  { section: "polling", key: "usageMin", label: "Token usage", help: "Scans session transcripts for new turns.", unit: "min", def: 10, min: 2, max: 240 },
  { section: "agents", key: "newPerCycle", label: "New agents per cycle", help: "The most agents one review-loop cycle starts. Sessions already on a PR don't count.", unit: "agents", def: 3, min: 1, max: 10 },
  { section: "agents", key: "reviewRounds", label: "Review rounds", help: "Rounds the review loop runs on a PR before it stops and hands it back to you.", unit: "rounds", def: 3, min: 1, max: 10 },
  { section: "agents", key: "roundHours", label: "Round time limit", help: "A round with no report after this long stops the loop.", unit: "h", def: 3, min: 1, max: 24 },
  { section: "agents", key: "lowMemoryPct", label: "Low memory", help: "Below this much free memory, the review loop starts no new agent.", unit: "% free", def: 15, min: 0, max: 50 },
  { section: "agents", key: "guides", label: "Field guides at once", help: "Field guide sessions for review requests running at the same time.", unit: "sessions", def: 2, min: 0, max: 10 },
  { section: "agents", key: "replays", label: "Replays per press", help: "Replays one press starts. The rest wait for the next press.", unit: "replays", def: 2, min: 1, max: 10 },
  { section: "schedule", key: "scheduled", label: "Scheduled agents", help: "1 runs Routines, the Monday architecture pass and the weekly loop on their schedule; 0 pauses all three. Their run buttons still work.", unit: "on", def: 1, min: 0, max: 1 },
  { section: "schedule", key: "workFrom", label: "Work starts after", help: "Routines that run when you start work wait for you at the Mac after this hour.", unit: ":00", def: 5, min: 0, max: 23 },
  { section: "schedule", key: "loopFrom", label: "Weekly loop from", help: "The weekly loop starts on the first weekday check at or after this hour.", unit: ":00", def: 9, min: 0, max: 23 },
  { section: "schedule", key: "loopUntil", label: "Weekly loop until", help: "No weekly loop starts at or after this hour; it waits for the next weekday.", unit: ":00", def: 12, min: 1, max: 24 },
  { section: "schedule", key: "suggestionsFrom", label: "Suggestions judged after", help: "Suggestions are judged on the first Jira poll after this hour, and the architecture pass runs on Monday's.", unit: ":00", def: 7, min: 0, max: 23 },
];

/** A knob's value: the saved one when it is in bounds, else the default. */
export function knob(section: KnobSection, key: string): number {
  const k = KNOBS.find((x) => x.section === section && x.key === key);
  if (!k) throw new Error(`no knob ${section}.${key}`);
  const v = SETTINGS[section]?.[key];
  return typeof v === "number" && Number.isInteger(v) && v >= k.min && v <= k.max ? v : k.def;
}

/** The tuning, read where it's used so a save applies on the next read. */
export const tuning = {
  detectMs: () => knob("polling", "detectMin") * 60_000,
  reconcileMs: () => knob("polling", "reconcileMin") * 60_000,
  jiraMs: () => knob("polling", "jiraMin") * 60_000,
  branchesMs: () => knob("polling", "branchesMin") * 60_000,
  mergedMs: () => knob("polling", "mergedMin") * 60_000,
  herdrMs: () => knob("polling", "herdrSec") * 1000,
  usageMs: () => knob("polling", "usageMin") * 60_000,
  newPerCycle: () => knob("agents", "newPerCycle"),
  reviewRounds: () => knob("agents", "reviewRounds"),
  roundMs: () => knob("agents", "roundHours") * 3_600_000,
  lowMemoryPct: () => knob("agents", "lowMemoryPct"),
  guides: () => knob("agents", "guides"),
  replays: () => knob("agents", "replays"),
  /** Whether Routines, the architecture pass and the weekly loop start on their own. */
  scheduled: () => knob("schedule", "scheduled") !== 0,
  workFrom: () => knob("schedule", "workFrom"),
  loopFrom: () => knob("schedule", "loopFrom"),
  loopUntil: () => knob("schedule", "loopUntil"),
  suggestionsFrom: () => knob("schedule", "suggestionsFrom"),
};

export const DEFAULT_BOT_PATTERN = "bot|^wiz-";

/** The keys the Settings page edits. The rest of the file (tracker, repos) is kept as it is. */
export const EDITABLE = ["org", "sentryOrg", "jiraProjects", "jiraSuggestSprints", "jiraSuggestLabel", "pickupHint", "aws", "awsMfaScript", "flow", "prs", "polling", "agents", "schedule", "machines"] as const;
type Editable = (typeof EDITABLE)[number];

const text = (k: string, v: unknown) => {
  if (typeof v !== "string") throw new Error(`${k} must be text`);
  return v.trim() || undefined;
};
const words = (k: string, v: unknown) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${k} must be a list of names`);
  const out = [...new Set(v.map((x: string) => x.trim()).filter(Boolean))];
  return out.length ? out : undefined;
};

function parkRules(v: unknown): ParkRule[] | undefined {
  if (!Array.isArray(v)) throw new Error("park rules must be a list");
  for (const r of v) {
    if (!r || typeof r !== "object" || typeof r.status !== "string" || !r.status.trim()) throw new Error("every park rule needs a status");
    if (r.note !== undefined && typeof r.note !== "string") throw new Error(`park rule ${r.status}: note must be text`);
    if (r.finishWhen !== undefined && (!Array.isArray(r.finishWhen) || r.finishWhen.some((x: unknown) => typeof x !== "string"))) throw new Error(`park rule ${r.status}: finishWhen must be a list of statuses`);
    if (r.wakeAfterDays !== undefined && !(Number.isInteger(r.wakeAfterDays) && r.wakeAfterDays > 0)) throw new Error(`park rule ${r.status}: wakeAfterDays must be a whole number of days`);
  }
  return v.length ? v : undefined;
}

function flow(v: unknown): Flow | undefined {
  if (!v || typeof v !== "object") throw new Error("flow must be an object");
  const f = v as Record<string, unknown>;
  const out: Flow = {
    stages: f.stages === undefined ? undefined : words("stages", f.stages),
    testingStatus: f.testingStatus === undefined ? undefined : text("testing status", f.testingStatus),
    approvedStatus: f.approvedStatus === undefined ? undefined : text("approved status", f.approvedStatus),
    who: f.who === undefined ? undefined : text("who tests", f.who),
    copySuffix: f.copySuffix === undefined ? undefined : text("copy suffix", f.copySuffix),
    parkRules: f.parkRules === undefined ? undefined : parkRules(f.parkRules),
  };
  return prune(out);
}

function knobs(section: KnobSection, v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object") throw new Error(`${section} must be an object`);
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(v as Record<string, unknown>)) {
    const k = KNOBS.find((x) => x.section === section && x.key === key);
    if (!k) throw new Error(`${section} has no setting ${key}`);
    if (n === null) continue; // back to the default
    if (typeof n !== "number" || !Number.isInteger(n) || n < k.min || n > k.max) throw new Error(`${k.label} must be a whole number from ${k.min} to ${k.max}`);
    if (n !== k.def) out[key] = n;
  }
  return prune(out);
}

function botPattern(v: unknown): { botPattern?: string } | undefined {
  const p = (v as { botPattern?: unknown } | null)?.botPattern;
  if (p === undefined || p === null || p === "") return undefined;
  if (typeof p !== "string") throw new Error("the bot pattern must be text");
  try { new RegExp(p, "i"); } catch (e) { throw new Error(`the bot pattern isn't a valid pattern: ${(e as Error).message}`); }
  return p.trim() === DEFAULT_BOT_PATTERN ? undefined : { botPattern: p.trim() };
}

function machines(v: unknown): Machine[] | undefined {
  if (!Array.isArray(v)) throw new Error("machines must be a list");
  const out: Machine[] = [];
  for (const m of v as Record<string, unknown>[]) {
    const name = typeof m?.name === "string" ? m.name.trim() : "";
    if (!/^[a-z0-9-]{1,20}$/.test(name)) throw new Error("a machine's name is up to 20 lowercase letters, digits and dashes");
    if (out.some((x) => x.name === name)) throw new Error(`two machines are named ${name}`);
    const ssh = typeof m.ssh === "string" ? m.ssh.trim() : "";
    // A login and host as ssh takes them, never an option.
    if (!/^[\w.-]+@[\w.-]+$|^[\w.][\w.-]*$/.test(ssh)) throw new Error(`${name}: the ssh target is user@host or a host from ~/.ssh/config`);
    const root = typeof m.reposRoot === "string" ? m.reposRoot.trim() : "";
    if (root && !/^(~|\/)[\w./~-]*$/.test(root)) throw new Error(`${name}: the repos folder is a path such as ~/Projects`);
    out.push({ name, ssh, ...(root && root !== "~/Projects" ? { reposRoot: root } : {}), ...(m.enabled === false ? { enabled: false } : {}) });
  }
  return out.length ? out : undefined;
}

/** Undefined for an object with nothing set, so an emptied section leaves the file. */
function prune<T extends object>(o: T): T | undefined {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return Object.keys(o).length ? o : undefined;
}

/** A change from the Settings page, checked: each key it names, cleaned, or undefined to drop the key. Throws on a bad value. */
export function cleanPatch(patch: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(EDITABLE as readonly string[]).includes(k)) throw new Error(`${k} isn't a setting the page can change`);
    const key = k as Editable;
    out[key] = v === null ? undefined
      : key === "flow" ? flow(v)
      : key === "prs" ? botPattern(v)
      : key === "machines" ? machines(v)
      : key === "polling" || key === "agents" || key === "schedule" ? knobs(key, v)
      : key === "aws" ? (typeof v === "boolean" ? v || undefined : (() => { throw new Error("aws must be on or off"); })())
      : key === "jiraProjects" || key === "jiraSuggestSprints" ? words(key, v)
      : text(key, v);
  }
  const s = out.schedule as Record<string, number> | undefined;
  const from = s?.loopFrom ?? knobDef("loopFrom"), until = s?.loopUntil ?? knobDef("loopUntil");
  if ("schedule" in out && from >= until) throw new Error("the weekly loop's window must end after it starts");
  if (out.jiraProjects && SETTINGS.tracker?.kind === "github") throw new Error("this project tracks GitHub Issues, not Jira");
  return out as Partial<Settings>;
}
const knobDef = (key: string) => KNOBS.find((k) => k.key === key)!.def;

const listeners: (() => void)[] = [];
/** Runs `f` after every save, for readers that keep something built from the settings. */
export const onSettingsChange = (f: () => void) => { listeners.push(f); };

/** Applies a checked change: in place in SETTINGS, and to the file unless `dryRun` (the dev server leaves it alone). */
export function saveSettings(patch: Record<string, unknown>, { dryRun = false } = {}): Settings {
  const clean = cleanPatch(patch);
  const apply = (into: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(clean)) { if (v === undefined) delete into[k]; else into[k] = v; }
    return into;
  };
  if (!dryRun) {
    const onDisk = apply(read() as Record<string, unknown>);
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(onDisk, null, 2) + "\n");
  }
  apply(SETTINGS as Record<string, unknown>);
  KNOWN_PROJECTS.splice(0, KNOWN_PROJECTS.length, ...knownProjects());
  for (const f of listeners) f();
  return SETTINGS;
}
