// What each agent is for, decided one way: the task the control room started it for (kept by pane),
// else the last skill its session ran (read from its transcript), else a guess from its tab label.
// A helper the control room started for one purpose keeps it; a session building or fixing takes on
// whatever skill it runs next, such as grilling a plan.
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Agent, AgentTask } from "../shared/types";
import { load, save } from "./db";
import { CLAUDE_DIR } from "./repos";
import { taskOfLabel } from "../shared/tasks";

export { taskOfLabel };

type StartLike = { kind: string; verb?: string; item: string };

/** The task the control room starts an agent for, from what it asked. */
export function taskForStart(req: StartLike): AgentTask {
  if (req.verb === "verify" || req.item.startsWith("verify-")) return "verify";
  if (req.verb === "chart") return "chart";
  if (req.kind === "selfreview") return "selfreview";
  if (req.kind === "review") return "review";
  if (["feedback", "ci", "conflicts", "fixreview", "stack"].includes(req.kind)) return "fix";
  // The weekly loop, lessons made to stick, architecture and friction reviews, and Stop-check hooks improve how work is done.
  if (/^(loop|lesson|arch|stop-check|routine-friction)-/.test(req.item)) return "improve";
  return "build";
}

/** Skills, by what doing them is. Unlisted skills say nothing about the task. */
const SKILLS: [RegExp, AgentTask][] = [
  [/grill/, "grill"],
  [/improve-codebase-architecture|codebase-design|domain-modeling|retro|writing-for-agents|fewer-permission-prompts/, "improve"],
  [/verify-change/, "verify"],
  [/code-review|security-review|review-queue/, "review"],
];
export const taskOfSkill = (skill: string): AgentTask | null => SKILLS.find(([re]) => re.test(skill))?.[1] ?? null;

/** The last skill a transcript shows run: typed as a slash command, or called by the agent. */
export function lastSkill(text: string): string | null {
  let at = -1, name: string | null = null;
  for (const re of [/<command-name>\/?([\w:.-]+)<\/command-name>/g, /"name":"Skill","input":\{"skill":"([^"]+)"/g]) {
    for (const m of text.matchAll(re)) if (m.index! > at) { at = m.index!; name = m[1]; }
  }
  return name;
}

const STICKY = new Set<AgentTask>(["selfreview", "review", "verify", "chart"]);
/** Which source wins: a purpose-built helper's start, then a skill, then the start, then the label. */
export function resolveTask(started: AgentTask | null, skill: AgentTask | null, label: string): { task: AgentTask; taskFrom: NonNullable<Agent["taskFrom"]> } {
  if (started && STICKY.has(started)) return { task: started, taskFrom: "start" };
  if (skill) return { task: skill, taskFrom: "skill" };
  if (started) return { task: started, taskFrom: "start" };
  return { task: taskOfLabel(label), taskFrom: "label" };
}

// ---------- what's kept ----------
// pane → what the control room started it for, and when. Older records kept only the task.
type Started = { task: AgentTask; at: string | null };
const started = new Map<string, Started>(Object.entries(load<Record<string, Started | AgentTask>>("agent_tasks") ?? {}).map(([k, v]) => [k, typeof v === "string" ? { task: v, at: null } : v]));
/** Called when the control room starts or reuses a session for a task. */
export function rememberTask(pane: string, task: AgentTask) {
  started.set(pane, { task, at: new Date().toISOString() });
  save("agent_tasks", Object.fromEntries(started));
}
/** When the control room gave a session its current task; null when it didn't, or doesn't know. */
export const startedAt = (pane: string) => started.get(pane)?.at ?? null;

/** What a session started for a task should hand over when it's done, and how to say so. */
export function finishLine(task: AgentTask): string {
  const done: Record<AgentTask, string> = {
    build: "when its PR merges or closes; until then, stay for review rounds",
    fix: "when its PR merges or closes; until then, stay for review rounds",
    selfreview: "when the PR's own session has taken your findings",
    review: "when your review is posted",
    verify: "when the verification run has its verdict",
    chart: "when the chart is published",
    improve: "when the report is written and its issues are filed",
    grill: "when the decisions are saved to a doc",
  };
  return `This session is done ${done[task]}. When it is, end your last message with a line \`DONE: <link or path to what you made>\`, so the control room can close this session.`;
}
/** Drops panes that are gone. */
export function forgetTasks(open: Set<string>) {
  let changed = false;
  for (const p of [...started.keys()]) if (!open.has(p)) { started.delete(p); changed = true; }
  if (changed) save("agent_tasks", Object.fromEntries(started));
}

// A session's transcript sits under the folder it started in, which isn't always where it is now (a
// worktree session moves); found by its id when the folder it's in now has no such file.
const found = new Map<string, string | null>();
export function transcriptPath(a: Pick<Agent, "session" | "cwd">): string | null {
  if (!a.session) return null;
  const here = join(CLAUDE_DIR, "projects", a.cwd.replace(/[/.]/g, "-"), `${a.session}.jsonl`);
  if (existsSync(here)) return here;
  if (!found.has(a.session)) found.set(a.session, [...new Bun.Glob(`*/${a.session}.jsonl`).scanSync({ cwd: join(CLAUDE_DIR, "projects"), absolute: true })][0] ?? null);
  return found.get(a.session) ?? here;
}

// Each transcript is read once, then only what's been added since.
const seen = new Map<string, { size: number; skill: string | null }>();
function skillIn(path: string): string | null {
  let size: number;
  try { size = statSync(path).size; } catch { return null; }
  const was = seen.get(path);
  if (was && was.size === size) return was.skill;
  const from = was && was.size < size ? was.size : 0, buf = Buffer.alloc(size - from);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
  const skill = lastSkill(buf.toString("utf8")) ?? (from ? was!.skill : null);
  seen.set(path, { size, skill });
  return skill;
}

/** An agent's task and where it came from. */
export function taskOf(a: Pick<Agent, "pane" | "label" | "session" | "cwd">) {
  const path = transcriptPath(a), skill = path ? skillIn(path) : null;
  return resolveTask(started.get(a.pane)?.task ?? null, skill ? taskOfSkill(skill) : null, a.label);
}
