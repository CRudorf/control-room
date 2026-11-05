// The World on its own, for a page to show people: made-up work (DEMO keys, a repo called widgets) and every
// part of the town busy, no board or server behind it. The skin is the page's own (<html data-skin>).
// Built into one file by scripts/world-demo.ts.
import { createRoot } from "react-dom/client";
import type { Agent, AgentTask, PrRow, WorkItem } from "../../shared/types";

const now = new Date().toISOString();
let pane = 0;
const agent = (name: string, status: Agent["status"], task: AgentTask, branch: string | null, o: Partial<Agent> = {}): Agent => ({
  pane: `demo:p${++pane}`, tab: `demo:t${pane}`, workspace: "demo", name, label: `agent ${name}`, title: "", workspaceLabel: "Demo", status,
  seq: 1, finishedSeq: null, cwd: "/demo", repo: "widgets", branch, upstream: null, head: null, session: null, task, since: now, ...o,
} as Agent);
const pr = (number: number, branch: string, o: Partial<PrRow> = {}): PrRow => ({
  repo: "acme/widgets", number, title: `Widget change ${number}`, url: "#", author: "you", draft: false, updated: now, checks: "success", pending_reviewers: [],
  branch, base: "main", head: "abc1234", id: `pr${number}`, merge_state: "CLEAN", can_merge: "yes", review_decision: null, last_activity: now, role: "mine", state: "waiting", feedback: [], ...o,
} as PrRow);
const item = (id: string, key: string, title: string, lane: WorkItem["lane"], why: string, prs: PrRow[], agents: Agent[], urgency = 1): WorkItem => ({
  id, key, keyKind: "jira", title, repos: ["widgets"], prs, agents, lane, why, urgency, cells: {}, primary: { label: "Open" }, updated: now,
} as unknown as WorkItem);

const ITEMS: WorkItem[] = [
  item("d1", "DEMO-101", "Sort widgets by colour", "mine", "2 review threads to answer", [pr(11, "demo-101")], [agent("cr-widgets-11", "working", "build", "demo-101"), agent("cr-widgets-11-review", "working", "selfreview", "demo-101")], 2),
  item("d2", "DEMO-102", "Faster widget search", "waiting", "waiting on CI", [pr(12, "demo-102", { checks: "pending" })], [agent("cr-widgets-12", "working", "build", "demo-102")]),
  item("d3", "DEMO-103", "Fix the widget count", "mine", "conflicts with main", [pr(13, "demo-103", { merge_state: "DIRTY" })], [agent("cr-widgets-13", "working", "fix", "demo-103")], 3),
  item("d4", "DEMO-104", "Widget export to CSV", "asked", "review requested by a teammate", [pr(14, "demo-104", { role: "requested" })], [agent("cr-review-14", "working", "review", "demo-104")], 2),
  item("d5", "DEMO-105", "Widget settings page", "waiting", "in a browser test", [pr(15, "demo-105")], [agent("cr-verify-15", "working", "verify", "demo-105")]),
  item("d6", "DEMO-106", "Chart the widget flow", "waiting", "charting", [pr(16, "demo-106")], [agent("cr-chart-16", "working", "chart", "demo-106")]),
  item("loop-demo", "loop-demo", "Weekly improvement", "waiting", "improving", [], [agent("cr-loop", "working", "improve", null)]),
  item("d8", "DEMO-108", "Plan the widget API", "waiting", "grilling a plan", [], [agent("cr-plan-108", "working", "grill", null), agent("cr-plan-108b", "working", "grill", null)]),
  item("d9", "DEMO-109", "Widget onboarding copy", "waiting", "waiting on a teammate's review", [pr(19, "demo-109", { pending_reviewers: ["a-teammate"] })], [agent("cr-widgets-19", "idle", "build", "demo-109"), agent("cr-widgets-19b", "idle", "build", "demo-109")]),
  item("d10", "DEMO-110", "Old widget cleanup", "mine", "agent cr-widgets-20 finished", [pr(20, "demo-110", { state: "merge" })], [agent("cr-widgets-20", "done", "build", "demo-110", { spent: { reason: "its PR merged", output: null, since: now, closesAt: null } })]),
  item("d11", "DEMO-111", "Widget permissions", "mine", "agent cr-widgets-21 is waiting on you", [pr(21, "demo-111")], [agent("cr-widgets-21", "blocked", "build", "demo-111")], 3),
  item("d12", "DEMO-112", "Widget logging", "waiting", "resting", [], [agent("cr-widgets-22", "idle", "build", null), agent("cr-widgets-23", "idle", "fix", null), agent("cr-widgets-24", "idle", "review", null)]),
  item("d13", "DEMO-113", "Widget docs", "mine", "1 bot thread", [pr(23, "demo-113")], [agent("cr-widgets-25", "working", "build", "demo-113"), agent("cr-widgets-26", "working", "fix", "demo-113")], 1),
];

// No server behind it: the agents keep the work they're given here, and actions on one find nothing to reach and say so.
try { localStorage.setItem("cr-world", JSON.stringify({ names: true, hideRoofs: true, overlays: true, demo: false })); } catch { /* the defaults, then */ }

void import("./world").then(({ default: World }) => {
  const none = () => {};
  createRoot(document.getElementById("root")!).render(<World items={ITEMS} onOpen={none} onBuilding={none} onPrimary={none} onSheet={none} onClose={none} />);
});
