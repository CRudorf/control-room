// What's running on a work item, drawn over its strip: an outline with moving stripes, a pill naming each
// run, and a scan bar per run along the bottom edge. One color per kind, so a glance says which.
import type { WorkItem } from "../shared/types";

export type RunKind = "ci" | "agent" | "loop" | "tests";
export const RUN_LABEL: Record<RunKind, string> = { ci: "CI running", agent: "agent working", loop: "loop round", tests: "local tests" };

/** The runs on an item now, in a fixed order: CI, agents, the review loop, Stop checks. */
export function runningKinds(it: Pick<WorkItem, "prs" | "agents" | "loop" | "stopChecks">): RunKind[] {
  const k: RunKind[] = [];
  if (it.prs.some((p) => p.checks === "pending")) k.push("ci");
  if (it.agents.some((a) => a.status === "working")) k.push("agent");
  if (it.loop?.some((l) => l.state === "running")) k.push("loop");
  if (it.stopChecks?.some((c) => c.running)) k.push("tests");
  return k;
}

export function Running({ kinds }: { kinds: RunKind[] }) {
  if (!kinds.length) return null;
  return <>
    <div className={`run-sheen k-${kinds[0]}`} />
    <div className="run-pill">{kinds.map((k) => <span key={k} className={`k-${k}`}><i className="spin" />{RUN_LABEL[k]}</span>)}</div>
    <div className="run-scan">{kinds.map((k) => <i key={k} className={`k-${k}`} />)}</div>
  </>;
}
