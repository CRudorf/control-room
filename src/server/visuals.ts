// The visual store: charts kept outside the repo under STATE_DIR/visuals/<id>/, so a visual outlives
// its work item. Each folder has a meta.json. The flows in docs/statecharts show as kind "flow".
// A "change" visual is a before/after pair that the chart-change skill writes for a PR.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VisualDetail, VisualMeta } from "../shared/types";
import { ROOT, STATE_DIR } from "./config";
import { herdrState } from "./herdr";
import { isDev, read, write, type Ctx } from "./runner";

export const VISUALS_DIR = join(STATE_DIR, "visuals");
const KINDS = new Set(["flow", "chart", "architecture", "change", "video"]);
const ID = /^[A-Za-z0-9._-]+$/;
const FILE = /^[A-Za-z0-9._-]+$/;
const FLOWS = join(ROOT, "docs", "statecharts");

/** Parses a meta.json text. Returns null when a field is missing or has the wrong type. */
export function parseMeta(text: string): VisualMeta | null {
  let m: any;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  if (typeof m.id !== "string" || !ID.test(m.id) || !KINDS.has(m.kind) || typeof m.title !== "string") return null;
  if (!(m.key === null || typeof m.key === "string") || !(m.pr === null || typeof m.pr === "string")) return null;
  if (typeof m.createdAt !== "string" || !(m.rulesHold === null || typeof m.rulesHold === "boolean")) return null;
  if (!Array.isArray(m.files) || !m.files.every((f: unknown) => typeof f === "string" && FILE.test(f))) return null;
  return { id: m.id, kind: m.kind, title: m.title, key: m.key, pr: m.pr, createdAt: m.createdAt, rulesHold: m.rulesHold,
    files: m.files, ...(typeof m.reason === "string" ? { reason: m.reason } : {}) };
}

/** The SVG that a card shows: after.svg for a change, else chart.svg, else the first SVG. */
export const thumbOf = (m: VisualMeta) =>
  m.files.find((f) => f === "after.svg") ?? m.files.find((f) => f === "chart.svg") ?? m.files.find((f) => f.endsWith(".svg")) ?? null;

/** True when report.md lists no rule that breaks. */
export const reportHolds = (report: string) => !/^## .+ (breaks|may break)\b/m.test(report) && !/Rules not checked/.test(report);

function flows(): (VisualMeta & { dir: string })[] {
  if (!existsSync(FLOWS)) return [];
  return readdirSync(FLOWS).sort().filter((n) => ID.test(n) && existsSync(join(FLOWS, n, "chart.svg"))).map((name) => {
    const dir = join(FLOWS, name);
    const mmd = existsSync(join(dir, "chart.mmd")) ? readFileSync(join(dir, "chart.mmd"), "utf8") : "";
    const report = existsSync(join(dir, "report.md")) ? readFileSync(join(dir, "report.md"), "utf8") : "";
    return { id: `flow-${name}`, kind: "flow" as const, title: mmd.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? name, key: null, pr: null,
      createdAt: statSync(join(dir, "chart.svg")).mtime.toISOString(), rulesHold: report ? reportHolds(report) : null,
      files: readdirSync(dir).filter((f) => FILE.test(f) && /\.(svg|mmd|md)$/.test(f)), dir };
  });
}

/** The mark that this visual is the one in its PR body. A PR body holds one "Flow change" section, so one visual has the mark. */
function readInPr(id: string): { pr: string; at: string } | null {
  try { return JSON.parse(readFileSync(join(VISUALS_DIR, id, "in-pr.json"), "utf8")); } catch { return null; }
}

function markInPr(id: string, pr: string, at = new Date().toISOString()) {
  for (const n of readdirSync(VISUALS_DIR)) if (n !== id && readInPr(n)?.pr === pr) rmSync(join(VISUALS_DIR, n, "in-pr.json"));
  writeFileSync(join(VISUALS_DIR, id, "in-pr.json"), JSON.stringify({ pr, at }));
}

function stored(): (VisualMeta & { dir: string })[] {
  if (!existsSync(VISUALS_DIR)) return [];
  return readdirSync(VISUALS_DIR).filter((n) => ID.test(n) && existsSync(join(VISUALS_DIR, n, "meta.json"))).flatMap((n) => {
    const m = parseMeta(readFileSync(join(VISUALS_DIR, n, "meta.json"), "utf8"));
    if (!m || m.id !== n) return [];
    const inPr = readInPr(n);
    return [{ ...m, ...(inPr && inPr.pr === m.pr ? { inPrAt: inPr.at } : {}), dir: join(VISUALS_DIR, n) }];
  });
}

const all = () => [...flows(), ...stored()];

/** The visuals, newest first. `key` keeps the ones for that work item key. `kind` keeps one kind. */
export function listVisuals(f: { key?: string | null; kind?: string | null } = {}): VisualMeta[] {
  const key = f.key?.trim().toUpperCase();
  return all().filter((v) => (!key || v.key?.toUpperCase() === key) && (!f.kind || v.kind === f.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ dir: _, ...m }) => m);
}

const find = (id: string) => (ID.test(id) ? all().find((v) => v.id === id) : undefined);

/** One visual with the text of its Markdown and Mermaid files. */
export function getVisual(id: string): VisualDetail | null {
  const v = find(id);
  if (!v) return null;
  const { dir, ...meta } = v;
  const text: Record<string, string> = {};
  for (const f of meta.files) if (/\.(md|mmd)$/.test(f) && existsSync(join(dir, f))) text[f] = readFileSync(join(dir, f), "utf8");
  return { meta, text };
}

/** The path of one file of a visual, or null when the visual does not list it. */
export function visualFile(id: string, file: string): string | null {
  const v = find(id);
  if (!v || !FILE.test(file) || !v.files.includes(file)) return null;
  const p = join(v.dir, file);
  return existsSync(p) ? p : null;
}

/** A new, empty folder in the store for a visual. */
export function newVisualDir(prefix: string): { id: string; dir: string } {
  const id = `${prefix.replace(/[^A-Za-z0-9._-]+/g, "-")}-${Date.now().toString(36)}`;
  const dir = join(VISUALS_DIR, id);
  mkdirSync(dir, { recursive: true });
  return { id, dir };
}

/** The result for a change that touches no flow: a meta with no chart and a one-line reason. */
export function noFlowChange(dir: string, id: string, o: { key: string | null; pr: string | null; reason: string }): VisualMeta {
  const meta: VisualMeta = { id, kind: "change", title: "No flow change", key: o.key, pr: o.pr, createdAt: new Date().toISOString(),
    rulesHold: null, files: [], reason: o.reason.split("\n")[0].slice(0, 300) };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

// The PR body section. Markers keep it in one place, so a second add replaces the first.
const OPEN = "<!-- flow-change -->";
const CLOSE = "<!-- /flow-change -->";

/** The "Flow change" section: the before and after charts as Mermaid, and the rule diff. */
export function flowSection(v: VisualDetail): string {
  const before = v.text["before.mmd"], after = v.text["after.mmd"], diff = v.text["diff.md"];
  if (!before || !after) throw new Error(`${v.meta.id} has no before.mmd and after.mmd`);
  return [OPEN, "## Flow change", "", `${v.meta.title}`, "", "### Before", "", "```mermaid", before.trim(), "```", "",
    "### After", "", "```mermaid", after.trim(), "```", "", ...(diff ? ["### Rule diff", "", diff.trim(), ""] : []), CLOSE].join("\n");
}

/** Puts the section in the body: replaces the text between the markers, or appends it. Keeps the other text. */
export function withSection(body: string, section: string): string {
  const a = body.indexOf(OPEN), b = body.indexOf(CLOSE, a);
  if (a >= 0 && b > a) return body.slice(0, a) + section + body.slice(b + CLOSE.length);
  const base = body.replace(/\s+$/, "");
  return base ? `${base}\n\n${section}` : section;
}

const prParts = (pr: string) => {
  const m = pr.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (!m) throw new Error(`${pr} is not owner/repo#number`);
  return { repo: m[1], n: m[2] };
};

/** What the PR body gets: the section and the full new body. Reads the body with gh. */
export async function flowChangePreview(id: string, pr: string) {
  const v = getVisual(id);
  if (!v) throw new Error(`no visual ${id}`);
  const { repo, n } = prParts(pr);
  const section = flowSection(v);
  const body = (await read(["gh", "pr", "view", n, "-R", repo, "--json", "body", "--jq", ".body"])).replace(/\s+$/, "");
  return { section, body: withSection(body, section), replaces: body.includes(OPEN) };
}

/** Writes the "Flow change" section to the PR body (action record "pr-flow-change"). A dev server only records it. */
export async function addFlowChange(ctx: Ctx, id: string, pr: string) {
  const { repo, n } = prParts(pr);
  const { section, body } = await flowChangePreview(id, pr);
  const result = await write(ctx, "pr-flow-change", pr, ["gh", "pr", "edit", n, "-R", repo, "--body", body], { drafted: section, detail: { visual: id } });
  if (!isDev()) markInPr(id, pr);
  return result;
}

/** The prompt for an agent that charts a PR's change into a new visual folder. */
export function chartPrompt(o: { pr: string; key: string | null; id: string; dir: string; merged: boolean }) {
  return `/chart-change ${o.pr} --dir "${o.dir}" --id ${o.id} --key ${o.key ?? "null"}${o.merged ? " --merged (the PR is merged: use diff.patch in the dir, the merge diff)" : ""}`;
}

/** Gets the PR diff with gh and saves it as diff.patch in the folder, so the agent reads the merge diff. */
export async function saveDiff(pr: string, dir: string) {
  const { repo, n } = prParts(pr);
  writeFileSync(join(dir, "diff.patch"), await read(["gh", "pr", "diff", n, "-R", repo], { timeoutMs: 60_000 }));
}

/** A new session can show as idle or missing at first. */
const CHART_GRACE_MS = 90_000;
export type ChartRun = { state: "charting" | "stalled"; id: string; agent: string; pane: string | null; at: string };
type AgentLite = { name: string | null; pane: string; status: string };

/**
 * The newest chart of a PR that has no result yet. Each started chart leaves charting.json in its folder,
 * and the skill's meta.json is the result. A session at work is "charting". A session that is idle or gone
 * with no result is "stalled". A folder with a result, or with no charting.json, is not a run.
 */
export function chartRun(pr: string, agents: AgentLite[] = herdrState().agents, now = Date.now()): ChartRun | null {
  if (!existsSync(VISUALS_DIR)) return null;
  const runs = readdirSync(VISUALS_DIR).flatMap((id) => {
    const f = join(VISUALS_DIR, id, "charting.json");
    if (!ID.test(id) || !existsSync(f)) return [];
    try { const r = JSON.parse(readFileSync(f, "utf8")); return r.pr === pr ? [{ id, agent: String(r.agent), at: String(r.at) }] : []; }
    catch { return []; }
  }).sort((a, b) => b.at.localeCompare(a.at));
  const r = runs[0];
  if (!r || existsSync(join(VISUALS_DIR, r.id, "meta.json"))) return null;
  const a = agents.find((x) => x.name === r.agent);
  return { ...r, pane: a?.pane ?? null, state: (a && (a.status === "working" || a.status === "blocked")) || now - Date.parse(r.at) < CHART_GRACE_MS ? "charting" : "stalled" };
}

const starting = new Set<string>();

/**
 * "Chart this change": a new visual folder and a background agent that runs /chart-change on the PR.
 * Outside dev it saves the PR diff first (for a merged PR, the merge diff). A dev server records the start and starts nothing.
 * A chart at work on the PR is returned as it is, so a second click starts nothing.
 */
export async function chartChange(o: { item: string; pr: string; key: string | null; merged: boolean }) {
  const run = chartRun(o.pr);
  if (run?.state === "charting") return { name: run.agent, id: run.id, already: true };
  if (starting.has(o.pr)) throw new Error("that chart is already starting");
  starting.add(o.pr);
  try { return await startChart(o); } finally { starting.delete(o.pr); }
}

async function startChart(o: { item: string; pr: string; key: string | null; merged: boolean }) {
  const { repo, n } = prParts(o.pr);
  const { id, dir } = newVisualDir(`change-${repo.split("/").pop()}-${n}`);
  if (!isDev()) await saveDiff(o.pr, dir);
  const { startAgent } = await import("./handoff");
  const r = await startAgent({ item: o.item, repo, pr: o.pr, kind: "custom", edited: false, bare: true, verb: "chart",
    prompt: chartPrompt({ pr: o.pr, key: o.key, id, dir, merged: o.merged }) });
  if (!r.dryRun) writeFileSync(join(dir, "charting.json"), JSON.stringify({ pr: o.pr, agent: r.name, at: new Date().toISOString() }));
  return { ...r, id };
}
