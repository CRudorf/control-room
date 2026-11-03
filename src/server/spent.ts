// When a session's job is done. Each task has its finish line (tasks.ts finishLine); a session past it is
// spent, and is closed: by itself after a grace period where the rule is exact, else with one click.
// Pure: the sweep in spentsweep.ts gathers the facts.
import type { Agent, AgentTask, WorkItem } from "../shared/types";

export type Spent = { reason: string; output: string | null; exact: boolean };
export type SpentFacts = {
  a: Pick<Agent, "pane" | "name" | "label" | "status" | "branch" | "since"> & { task: AgentTask };
  /** The work item it's on, if any. */
  it: Pick<WorkItem, "keyKind" | "lane" | "prs"> | null;
  /** Its last turn's DONE line, if it has one. */
  done: string | null | undefined;
  /** When the control room started it for this task. */
  startedAt: string | null;
  /** Charts by PR (owner/repo#n), with when each was made and a link. */
  charts: { pr: string | null; createdAt: string; url: string }[];
  /** Verification runs by the agent testing them, and whether every check has its result. */
  runs: { agent: string | null; reported: boolean; url: string }[];
  /** PRs by branch that merged or closed. */
  ended: Map<string, "merged" | "closed">;
  now: number;
};

/** Tasks whose finish line is exact enough to close the session without asking. */
export const AUTO = new Set<AgentTask>(["selfreview", "review", "chart", "verify", "improve"]);
const DAY = 24 * 3600_000;

/** Why a session is spent, and what it leaves, or null while its job isn't done. */
export function spentOf(f: SpentFacts): Spent | null {
  const { a, it } = f;
  // A session at work, or waiting on the user, is never spent.
  if (a.status === "working" || a.status === "blocked") return null;
  const exact = AUTO.has(a.task);
  if (f.done !== undefined) return { reason: "said it's done", output: f.done, exact };
  const pr = it?.prs.find((p) => p.branch === a.branch) ?? it?.prs[0];
  const ref = pr ? `${pr.repo}#${pr.number}` : null;
  if (a.task === "review") {
    if (!it || !it.prs.length) return { reason: "its review request is gone", output: null, exact };
    if (it.keyKind === "review" && it.lane !== "asked") return { reason: "your review is posted", output: pr?.url ?? null, exact };
  }
  if (a.task === "chart" && ref) {
    const c = f.charts.find((v) => v.pr === ref && (!f.startedAt || v.createdAt >= f.startedAt));
    if (c) return { reason: "the chart is published", output: c.url, exact };
  }
  if (a.task === "verify") {
    const r = f.runs.find((x) => x.agent && (x.agent === a.name || x.agent === a.label) && x.reported);
    if (r) return { reason: "the run has its results", output: r.url, exact };
  }
  if ((a.task === "build" || a.task === "fix") && a.branch && !it?.prs.some((p) => p.branch === a.branch)) {
    const how = f.ended.get(a.branch);
    if (how) return { reason: `its PR ${how}`, output: null, exact: false };
  }
  // Idle a day with nothing open for it: worth asking.
  if (a.since && f.now - Date.parse(a.since) > DAY && (!it || !it.prs.length)) return { reason: "idle a day with no open PR", output: null, exact: false };
  return null;
}

/** The DONE line closing a turn: its link or path, or "" when it gave none; undefined when there's no line. */
export function doneLine(turn: string | null): string | undefined {
  const m = turn?.match(/^\s*DONE:[ \t]*(.*)$/m);
  return m ? m[1].trim().replace(/^`|`$/g, "") : undefined;
}
