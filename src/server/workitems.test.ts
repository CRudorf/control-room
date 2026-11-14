import { describe, expect, test } from "bun:test";
import type { Agent, Dependency, Issue, PrRow, WorkItem } from "../shared/types";
import { applyCommentWaits, applyGates, applyIdleAgents, applyJira, applyRuns, runMovedOn, branchFamily, cleanTitle, finishedToday, groupWorkItems, quietAgentsByKey, trackerKey, rankNext, errorKey, shutGates, sortItems, suggestFinished, suggestFor } from "./workitems";
import { featureOf } from "./metrics";

let n = 100;
function pr(over: Partial<PrRow>): PrRow {
  n++;
  return {
    repo: "acme/widgets", number: n, title: "a change", url: `https://github.com/acme/widgets/pull/${n}`,
    author: "me", draft: false, updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: ["pat"],
    branch: `branch-${n}`, base: "main", head: "abc", id: `PR_${n}`, merge_state: "BLOCKED", can_merge: "needs approval",
    review_decision: "REVIEW_REQUIRED", last_activity: "2030-01-01T00:00:00Z", role: "mine", state: "waiting",
    feedback: [], rerequest: [], mark: null, superseded: null, ...over,
  };
}

function agent(over: Partial<Agent>): Agent {
  n++;
  return {
    pane: `w1:p${n}`, tab: `w1:t${n}`, workspace: "w1", name: null, label: `tab ${n}`, title: "", workspaceLabel: "ws",
    status: "working", cwd: "/tmp/x", repo: "widgets", branch: "main", session: null, focused: false, seq: 1, finishedSeq: null, ...over,
  };
}

describe("keys", () => {
  test("a Sentry short id is never read as a Jira key", () => {
    expect(errorKey("fix(api): ABC-3-API-1V stop drops")).toBe("ABC-3-API-1V");
    expect(trackerKey("fix(api): ABC-3-API-1V stop drops")).toBeNull();
    expect(trackerKey("ABC-3-CLIENT-N fix: also ABC-12")).toBe("ABC-12");
  });
  test("branches yield Jira keys only for known projects", () => {
    expect(trackerKey("update-deps-2", new Set(["ABC"]))).toBeNull();
    expect(trackerKey("abc-77-thing", new Set(["ABC"]))).toBe("ABC-77");
    expect(errorKey("fix/abc-3-client-m-signal")).toBe("ABC-3-CLIENT-M");
  });
  test("a Jira key in a long branch isn't mistaken for a Sentry id", () => {
    expect(errorKey("hb-8114-tracking-url-on-status-page")).toBeNull();
    expect(trackerKey("hb-8114-tracking-url-on-status-page", new Set(["HB"]))).toBe("HB-8114");
  });
  test("titles lose keys and conventional prefixes", () => {
    expect(cleanTitle("ABC-616: null the url")).toBe("null the url");
    expect(cleanTitle("[ABC-996] fix(analytics): reconcile events")).toBe("reconcile events");
    expect(cleanTitle("fix(api): ABC-3-API-1V stop drops")).toBe("stop drops");
  });
});

describe("grouping", () => {
  test("one Jira issue across repos is one work item", () => {
    const items = groupWorkItems([
      pr({ title: "ABC-1: part one", repo: "acme/a" }),
      pr({ title: "ABC-1: part two", repo: "acme/b" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("ABC-1");
    expect(items[0].repos).toEqual(["a", "b"]);
  });
  test("a Sentry work item merges into the Jira one once a PR names both", () => {
    const items = groupWorkItems([
      pr({ title: "ABC-3-CLIENT-N fix: sign-out" }),
      pr({ title: "ABC-9: ABC-3-CLIENT-N follow-up" }),
    ]);
    expect(items.map((i) => i.key)).toEqual(["ABC-9"]);
  });
  test("no key falls back to the branch", () => {
    const [it] = groupWorkItems([pr({ title: "chore: tidy", branch: "tidy-up" })]);
    expect(it.keyKind).toBe("branch");
    expect(it.key).toBe("tidy-up");
  });
  test("a series of branches under one prefix is one work item; conventional prefixes are not", () => {
    expect(branchFamily("retire-x/2-app")).toBe("retire-x");
    expect(branchFamily("fix/thing")).toBe("fix/thing");
    const items = groupWorkItems([
      pr({ title: "retire x: one", branch: "retire-x/1-a" }),
      pr({ title: "retire x: two", branch: "retire-x/2-b" }),
      pr({ title: "fix: a", branch: "fix/a" }),
      pr({ title: "fix: b", branch: "fix/b" }),
    ]);
    expect(items.map((i) => i.key).sort()).toEqual(["fix/a", "fix/b", "retire-x"]);
  });
  test("review requests stay separate and point at the related work item", () => {
    const items = groupWorkItems([
      pr({ title: "ABC-5: mine" }),
      pr({ title: "ABC-5: theirs", role: "requested", author: "pat", direct: true }),
    ]);
    const review = items.find((i) => i.keyKind === "review")!;
    expect(items).toHaveLength(2);
    expect(review.lane).toBe("asked");
    expect(review.related).toEqual([items[0].id]);
  });
});

describe("lanes", () => {
  test("feedback, conflicts, failing CI and approval put it in My turn", () => {
    for (const over of [
      { state: "address" as const, feedback: [{ kind: "thread" as const, who: "pat", bot: false, url: "", at: "", body: "" }] },
      { merge_state: "DIRTY" },
      { checks: "failure" },
      { state: "merge" as const, merge_state: "CLEAN", can_merge: "yes" },
      { state: "re-request" as const, rerequest: ["pat"] },
    ]) expect(groupWorkItems([pr(over)])[0].lane).toBe("mine");
  });
  test("waiting on reviewers, handed off or addressed is Waiting on others", () => {
    for (const over of [{}, { state: "handed-off" as const }, { state: "addressed" as const }, { draft: true, state: "draft" as const }])
      expect(groupWorkItems([pr(over)])[0].lane).toBe("waiting");
  });
  test("the most urgent PR decides the item's lane", () => {
    const [it] = groupWorkItems([pr({ title: "ABC-2: a" }), pr({ title: "ABC-2: b", checks: "failure" })]);
    expect(it.lane).toBe("mine");
    expect(it.why).toContain("CI failing");
  });
  test("sorting puts My turn first, most urgent first", () => {
    const items = sortItems(groupWorkItems([
      pr({ title: "ABC-1: waiting" }),
      pr({ title: "ABC-2: ci", checks: "failure" }),
      pr({ title: "ABC-3: conflict", merge_state: "DIRTY" }),
    ]));
    expect(items.map((i) => i.key)).toEqual(["ABC-3", "ABC-2", "ABC-1"]);
  });
});

describe("self-review", () => {
  test("findings on my PR's current commit make it my turn, fixing them with an agent", () => {
    const p = pr({ title: "ABC-9: x" });
    const [it] = groupWorkItems([p], [], new Map(), new Set(), new Map([[`${p.repo}#${p.number}`, 3]]));
    expect(it.lane).toBe("mine");
    expect(it.why).toContain("self-review found 3");
    expect(it.primary).toMatchObject({ handoff: "fixreview", label: expect.stringContaining("Fix 3 self-review findings") });
  });
});

describe("agents", () => {
  test("an agent joins the work item of its worktree's branch", () => {
    const items = groupWorkItems([pr({ title: "ABC-1: x", branch: "feat/abc-1" })], [agent({ branch: "feat/abc-1", status: "blocked" })]);
    expect(items).toHaveLength(1);
    expect(items[0].agents).toHaveLength(1);
    expect(items[0].lane).toBe("mine");
    expect(items[0].why).toContain("waiting on you");
    expect(items[0].primary.agent).toBeDefined();
  });
  test("an agent on a branch of its own joins the PR it pushes to, by upstream or by commit", () => {
    const p = pr({ title: "fix: x", branch: "fix/x", head: "c0ffee" });
    const items = groupWorkItems([p], [
      agent({ branch: "x-merge", upstream: "fix/x", status: "done" }),
      agent({ branch: "other", head: "c0ffee", label: "another" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].agents).toHaveLength(2);
  });
  test("else a PR ref or key in its tab label", () => {
    const p = pr({ title: "ABC-2: y" });
    const items = groupWorkItems([p], [agent({ label: `fix widgets#${p.number}` }), agent({ label: "rca ABC-2" })]);
    expect(items).toHaveLength(1);
    expect(items[0].agents).toHaveLength(2);
    expect(items[0].lane).toBe("waiting");
    expect(items[0].why).toContain("working");
  });
  test("a finished agent puts its work item in My turn", () => {
    const [it] = groupWorkItems([pr({ title: "ABC-3: z", branch: "b3" })], [agent({ branch: "b3", status: "done" })]);
    expect(it.lane).toBe("mine");
    expect(it.cells.ag.text).toBe("DONE");
  });
  test("an agent of its own shows only while it needs looking at or works", () => {
    const items = groupWorkItems([], [agent({ label: "spike", status: "done", repo: null }), agent({ label: "old", status: "idle" })]);
    expect(items.map((i) => i.key)).toEqual(["spike"]);
    expect(items[0].keyKind).toBe("agent");
    expect(items[0].lane).toBe("mine");
  });
  test("sessions without a work item gather under their repo; a task and an investigation keep their own", () => {
    const items = groupWorkItems([], [agent({ label: "rca api-1v", repo: "control-room" }), agent({ label: "tweak", repo: "control-room", status: "blocked" }), agent({ label: "fiddle", repo: "control-room", status: "blocked" }), agent({ label: "task-tidy-the-logs" })]);
    expect(items.map((i) => [i.key, i.agents.length]).sort()).toEqual([["control-room", 2], ["rca api-1v", 1], ["task-tidy-the-logs", 1]]);
  });
  test("an investigation tab labelled with its error report's short id is that report's work item", () => {
    const items = groupWorkItems([], [agent({ label: "rca ABC-3-CLIENT-M", repo: "widgets" }), agent({ label: "rca ABC-3-API-2", repo: "widgets" })]);
    expect(items.map((i) => [i.key, i.keyKind]).sort()).toEqual([["ABC-3-API-2", "agent"], ["ABC-3-CLIENT-M", "agent"]]);
  });
  test("a task, a routine's run and the weekly loop keep their own item, from the tab label the control room gives them", () => {
    const items = groupWorkItems([], [
      agent({ label: "agent task-tidy-the-logs", repo: "widgets" }),
      agent({ label: "agent routine-errors-widgets", repo: "widgets", status: "done" }),
      agent({ label: "agent loop-2030-01-07", repo: "control-room" }),
      agent({ label: "agent tweak", repo: "widgets", status: "blocked" }),
    ]);
    expect(items.map((i) => i.key).sort()).toEqual(["loop-2030-01-07", "routine-errors-widgets", "task-tidy-the-logs", "widgets"]);
  });
  test("an RCA tab naming a Sentry issue by its tail joins that work item", () => {
    const items = groupWorkItems([pr({ title: "ABC-3-CLIENT-M fix: a" })], [agent({ label: "rca client-m", name: "rca-client-m" }), agent({ label: "rca client-n" })]);
    expect(items.find((i) => i.key === "ABC-3-CLIENT-M")!.agents).toHaveLength(1);
    expect(items.map((i) => i.key).sort()).toEqual(["ABC-3-CLIENT-M", "rca client-n"]);
  });
  test("a finish herdr counted seen still shows, as finished, until it's looked at", () => {
    const [it] = groupWorkItems([], [agent({ label: "spike", status: "idle", finishedSeq: 4 })]);
    expect(it.lane).toBe("mine");
    expect(it.cells.ag.text).toBe("DONE");
    expect(it.primary.label).toBe("Check agent's work");
  });
  test("agents with the same Sentry key in their labels share a work item", () => {
    const items = groupWorkItems([], [agent({ label: "rca ABC-3-API-1V" }), agent({ label: "fix ABC-3-API-1V" })]);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("ABC-3-API-1V");
  });
});

describe("primary action", () => {
  const primary = (over: Partial<PrRow>, reran = new Set<string>()) => groupWorkItems([pr(over)], [], new Map(), reran)[0].primary;
  test("follows the action flows ranking", () => {
    expect(primary({ merge_state: "DIRTY", checks: "failure" }).handoff).toBe("conflicts");
    expect(primary({ checks: "failure", state: "address" }).act).toBe("rerun");
    expect(primary({ state: "address" }).handoff).toBe("feedback");
    expect(primary({ state: "re-request", rerequest: ["pat"] })).toMatchObject({ act: "rerequest", label: expect.stringContaining("pat") });
    expect(primary({ merge_state: "BEHIND", state: "merge" }).act).toBe("update");
    expect(primary({ state: "merge", merge_state: "CLEAN", can_merge: "yes" }).url).toBeDefined();
  });
  test("failed CI on a branch behind its base updates it before any rerun", () => {
    expect(primary({ checks: "failure", behind_by: 3 })).toMatchObject({ act: "update", label: expect.stringMatching(/^Update widgets#\d+ from main$/) });
    expect(primary({ checks: "failure", merge_state: "BEHIND" }).act).toBe("update");
    expect(primary({ checks: "failure", behind_by: 0 }).act).toBe("rerun");
  });
  test("a second CI failure on the same commit goes to an agent", () => {
    const p = pr({ checks: "failure", head: "abc" });
    const [it] = groupWorkItems([p], [], new Map(), new Set([`${p.repo}#${p.number}@abc`]));
    expect(it.primary.handoff).toBe("ci");
  });
});

describe("next queue", () => {
  const ranked = (rows: PrRow[], agents: Agent[] = []) =>
    rankNext(groupWorkItems(rows, agents)).filter((i) => i.next).sort((a, b) => a.next!.rank - b.next!.rank);
  test("stuck agents, then handoffs, then quick acts, then finished agents", () => {
    const q = ranked([
      pr({ title: "ABC-1: mergeable", state: "merge", merge_state: "CLEAN", can_merge: "yes" }),
      pr({ title: "ABC-2: conflicts", merge_state: "DIRTY" }),
      pr({ title: "ABC-3: done agent" }),
      pr({ title: "ABC-4: review", role: "requested", author: "pat" }),
    ], [agent({ label: "ABC-3 fix", status: "done" }), agent({ label: "spike", status: "blocked", repo: null })]);
    expect(q.map((i) => [i.key, i.next!.step])).toEqual([
      ["spike", "answer"], ["ABC-2", "start"], ["ABC-4", "start"], ["ABC-1", "quick"], ["ABC-3", "check"],
    ]);
  });
  test("within a step, most urgent then stalest first", () => {
    const q = ranked([
      pr({ title: "ABC-1: newer", state: "re-request", rerequest: ["pat"], last_activity: "2030-01-03T00:00:00Z" }),
      pr({ title: "ABC-2: older", state: "re-request", rerequest: ["pat"], last_activity: "2030-01-02T00:00:00Z" }),
      pr({ title: "ABC-3: behind", state: "merge", merge_state: "BEHIND", last_activity: "2030-01-01T00:00:00Z" }),
    ]);
    expect(q.map((i) => i.key)).toEqual(["ABC-2", "ABC-1", "ABC-3"]);
  });
  test("waiting work, and work an agent is on, stays out", () => {
    const q = ranked([
      pr({ title: "ABC-1: with a reviewer" }),
      pr({ title: "ABC-2: conflicts", merge_state: "DIRTY" }),
    ], [agent({ label: "ABC-2 fix", status: "working" })]);
    expect(q).toEqual([]);
  });
  test("a mergeable PR says merge", () => {
    const [it] = groupWorkItems([pr({ state: "merge", merge_state: "CLEAN", can_merge: "yes" })]);
    expect(it.primary.label).toStartWith("Merge ");
  });
});

describe("local grouping", () => {
  test("a PR moved by hand joins another work item, or splits out on its own", () => {
    const a = pr({ title: "ABC-1: one" }), b = pr({ title: "ABC-1: two" }), c = pr({ title: "ABC-2: other" });
    const moves = new Map([[`${b.repo}#${b.number}`, null], [`${c.repo}#${c.number}`, { id: "abc-1", key: "ABC-1", kind: "jira" as const }]]);
    const items = groupWorkItems([a, b, c], [], new Map(), new Set(), new Map(), moves);
    const abc1 = items.find((i) => i.key === "ABC-1")!;
    expect(abc1.prs.map((p) => p.number)).toEqual([a.number, c.number]);
    expect(abc1.moved).toEqual([`${c.repo}#${c.number}`]);
    expect(items.find((i) => i.prs[0] === b)!.key).toBe(`widgets#${b.number}`);
    expect(items.some((i) => i.key === "ABC-2")).toBeFalse();
  });

  const blocked = (rows: PrRow[], dependencies: Map<string, Dependency>, merged = new Set<string>(), agents: Agent[] = []) =>
    applyGates(groupWorkItems(rows, agents, new Map(), new Set(), new Map(), new Map(), shutGates(dependencies, merged)), dependencies, merged);
  const dependency = (p: PrRow, on: string | null, step = "") => new Map([[`${p.repo}#${p.number}`, { ref: `${p.repo}#${p.number}`, on, step, setAt: "2030-01-01T00:00:00Z" }]]);

  test("a blocked PR waits until the PR it waits on merges", () => {
    const p = pr({ title: "ABC-1: apply", merge_state: "DIRTY" });
    expect(blocked([p], dependency(p, "acme/infra#9"))[0]).toMatchObject({ lane: "waiting", urgency: 0 });
    expect(blocked([p], dependency(p, "acme/infra#9"))[0].why).toStartWith(`widgets#${p.number} blocked on infra#9`);
    const [open] = blocked([p], dependency(p, "acme/infra#9"), new Set(["acme/infra#9"]));
    expect(open.lane).toBe("mine");
    expect(open.dependencies![0].opened).toBe("infra#9 merged");
    expect(open.why).toStartWith("unblocked: infra#9 merged");
  });

  test("only the blocked PR waits: the rest of the work item still counts", () => {
    const held = pr({ title: "ABC-1: apply", merge_state: "DIRTY" }), other = pr({ title: "ABC-1: app", checks: "failure" });
    const [it] = blocked([held, other], dependency(held, null, "prod apply"));
    expect(it.lane).toBe("mine");
    expect(it.primary.pr).toBe(`${other.repo}#${other.number}`);
    expect(it.why).toEndWith(`widgets#${held.number} blocked on prod apply`);
  });

  test("an agent that needs Pat still puts a blocked item in My turn", () => {
    const p = pr({ title: "ABC-1: apply", merge_state: "DIRTY" });
    expect(blocked([p], dependency(p, null, "prod apply"), new Set(), [agent({ label: "ABC-1 fix", status: "blocked" })])[0].lane).toBe("mine");
  });

  test("finished today groups by work item and leaves out anything still open", () => {
    const row = (n: number, title: string, at: string, state: "merged" | "closed" = "merged") =>
      ({ ref: `acme/widgets#${n}`, at, state, title, url: `u${n}`, repo: "acme/widgets", branch: `b${n}` });
    const open = groupWorkItems([pr({ title: "ABC-3: still open" })]);
    const f = finishedToday([
      row(1, "ABC-1: first", "2030-01-02T10:00:00Z"), row(2, "ABC-1: second", "2030-01-02T12:00:00Z", "closed"),
      row(3, "ABC-3: done part", "2030-01-02T11:00:00Z"), row(4, "ABC-4: yesterday", "2030-01-01T11:00:00Z"),
    ], open, featureOf, "2030-01-02T00:00:00Z");
    expect(f).toEqual([{ key: "ABC-1", title: "first", repos: ["widgets"], at: "2030-01-02T12:00:00Z",
      prs: [{ ref: "acme/widgets#1", url: "u1", title: "ABC-1: first", state: "merged" }, { ref: "acme/widgets#2", url: "u2", title: "ABC-1: second", state: "closed" }] }]);
  });
});

describe("jira", () => {
  const issue = (over: Partial<Issue>): Issue => ({
    key: "ABC-1", summary: "Make the widget faster", status: "In Progress", category: "indeterminate", mine: true, updated: "2030-01-01T00:00:00Z",
    url: "https://example.test/browse/ABC-1", transitions: ["To Do", "In Progress", "Needs Review", "Done"].map((to, i) => ({ id: String(i), name: to, to })), ...over,
  });
  test("an open PR suggests a review status; a draft on a To Do issue suggests In Progress", () => {
    expect(suggestFor(issue({}), [pr({ title: "ABC-1: x" })])).toMatchObject({ to: "Needs Review", id: "2" });
    expect(suggestFor(issue({ status: "Needs Review" }), [pr({ title: "ABC-1: x" })])).toBeNull();
    expect(suggestFor(issue({ status: "To Do", category: "new" }), [pr({ title: "ABC-1: x", draft: true })])).toMatchObject({ to: "In Progress" });
    expect(suggestFor(issue({ status: "Done", category: "done" }), [pr({ title: "ABC-1: x" })])).toBeNull();
  });
  test("an In Progress issue with nothing on the board is a work item to start; review, parked and others' issues stay off", () => {
    const items = applyJira([], new Map([["ABC-1", issue({})], ["ABC-2", issue({ key: "ABC-2", status: "Needs Review" })], ["ABC-3", issue({ key: "ABC-3", mine: false })], ["ABC-4", issue({ key: "ABC-4", status: "PARKING LOT" })]]));
    expect(items.map((i) => [i.key, i.lane, i.primary.label])).toEqual([["ABC-1", "mine", "Start ABC-1"]]);
    expect(rankNext(items).find((i) => i.key === "ABC-1")!.next!.step).toBe("start");
  });
  test("a Jira work item with PRs gets its status, and no second item", () => {
    const items = applyJira(groupWorkItems([pr({ title: "ABC-1: x" })]), new Map([["ABC-1", issue({})]]));
    expect(items).toHaveLength(1);
    expect(items[0].jira).toMatchObject({ status: "In Progress", suggest: { to: "Needs Review" } });
  });
  test("every PR merged today suggests moving the issue on", () => {
    const f = { key: "ABC-1", title: "x", repos: [], at: "", prs: [{ ref: "r", url: "u", title: "t", state: "merged" as const }] };
    expect(suggestFinished(issue({ status: "Needs Review" }), f)).toMatchObject({ to: "Done" });
    expect(suggestFinished(issue({}), { ...f, prs: [...f.prs, { ...f.prs[0], state: "closed" }] })).toBeNull();
  });
});

describe("merge queue", () => {
  const q = (state = "QUEUED") => ({ position: 2, state, since: "2030-01-02T00:00:00Z" });
  test("a queued PR waits on the queue: no merge or update action, a QUEUED cell", () => {
    const [it] = groupWorkItems([pr({ state: "merge", merge_state: "BEHIND", can_merge: "in merge queue (#2)", merge_queue: q() })]);
    expect(it.lane).toBe("waiting");
    expect(it.why).toMatch(/in merge queue, #2$/);
    expect(it.cells.mg.text).toBe("QUEUED");
    expect(it.primary.label).toStartWith("Open ");
  });
  test("a queue that can't merge it hands it back", () => {
    const [it] = groupWorkItems([pr({ state: "merge", can_merge: "merge queue can't merge it", merge_queue: q("UNMERGEABLE") })]);
    expect(it.lane).toBe("mine");
    expect(it.why).toStartWith("merge queue can't merge");
  });
});

describe("unattended runs", () => {
  const run = { key: "ABC-1", at: "2030-01-01T00:00:00Z", agent: "cr-x" };
  test("a finished run hands the work item back for review", () => {
    const [it] = applyRuns(groupWorkItems([pr({ title: "ABC-1: a fix" })], [agent({ label: "agent ABC-1", status: "done" })]), new Map([["ABC-1", run]]));
    expect(it).toMatchObject({ lane: "mine", primary: { label: "Review run ABC-1", run: "ABC-1" } });
    expect(rankNext([it])[0].next!.step).toBe("check");
  });
  test("while its agent works, nothing changes", () => {
    const items = groupWorkItems([pr({ title: "ABC-1: a fix" })], [agent({ label: "agent ABC-1", status: "working" })]);
    expect(applyRuns(items, new Map([["ABC-1", run]]))).toEqual(items);
  });
});

describe("a run that moved on", () => {
  const run = { key: "ABC-1", at: "2026-10-30T00:00:00Z", agent: "a" };
  const issue = (status: string): Issue => ({ key: "ABC-1", summary: "s", status, category: "indeterminate", mine: true, updated: run.at, url: "u", transitions: [] });
  const empty = groupWorkItems([], [{ pane: "p", tab: "t", workspace: "w", name: "a", label: "agent ABC-1", title: "", workspaceLabel: "", status: "idle", seq: 1, finishedSeq: 1, cwd: "/x", repo: "widgets", branch: null, upstream: null, head: null } as any])[0];
  const after = "2026-10-31T00:00:00Z", before = "2026-10-29T00:00:00Z";
  test("product testing ends it", () => expect(runMovedOn(run, empty, issue("Testing"), [])).toBe(true));
  test("still In Progress with no PR, it holds", () => expect(runMovedOn(run, empty, issue("In Progress"), [])).toBe(false));
  test("a PR merged after the run ends it", () => expect(runMovedOn(run, empty, issue("In Progress"), [after])).toBe(true));
  test("a PR merged before the run doesn't", () => expect(runMovedOn(run, empty, issue("In Progress"), [before])).toBe(false));
  test("an open PR keeps it", () => {
    const open = { ...empty, prs: [pr({ title: "ABC-1: x" })] };
    expect(runMovedOn(run, open, issue("In Progress"), [after])).toBe(false);
  });
  test("the item keeps its lane", () => {
    const waiting = { ...empty, lane: "waiting" as const };
    expect(applyRuns([waiting], new Map([["ABC-1", run]]), () => true)[0].lane).toBe("waiting");
  });
});

describe("agents that name no key", () => {
  const agent = (over: Partial<Agent> = {}): Agent => ({ pane: "p1", tab: "t1", workspace: "w", name: "cr-x-12", label: "selfreview widgets#12", title: "", workspaceLabel: "", status: "done", seq: 1, finishedSeq: 1, cwd: "/x", repo: "widgets", branch: null, upstream: null, head: null, ...over } as Agent);
  const keyOfRef = (r: string) => (r === "widgets#12" ? "ABC-9" : null);
  test("a tab that names a merged PR joins that PR's key", () =>
    expect(groupWorkItems([], [agent()], undefined, undefined, undefined, undefined, undefined, { keyOfRef }).map((i) => i.key)).toEqual(["ABC-9"]));
  test("with an unknown PR it stays with its repo", () =>
    expect(groupWorkItems([], [agent()]).map((i) => i.key)).toEqual(["widgets"]));
  test("the user's move beats the names, even for an idle agent", () => {
    const moved = new Map([["cr-x-12", { id: "abc-7", key: "ABC-7", kind: "jira" as const }]]);
    const [it] = groupWorkItems([], [agent({ status: "idle", finishedSeq: null })], undefined, undefined, undefined, undefined, undefined, { keyOfRef, agentMoves: moved });
    expect(it.key).toBe("ABC-7");
    expect(it.agentsMoved).toEqual(["cr-x-12"]);
  });
  test("moved out on its own, it gets its own item", () => {
    const [it] = groupWorkItems([], [agent()], undefined, undefined, undefined, undefined, undefined, { keyOfRef, agentMoves: new Map([["cr-x-12", null]]) });
    expect(it.key).toBe("cr-x-12");
  });
});

describe("idle agents on an issue with no PR", () => {
  const agent = (over: Partial<Agent> = {}): Agent => ({ pane: "p1", tab: "t1", workspace: "w", name: "cr-x", label: "agent ABC-9", title: "", workspaceLabel: "", status: "idle", seq: 1, finishedSeq: null, cwd: "/x", repo: "widgets", branch: null, upstream: null, head: null, ...over } as Agent);
  const issue: Issue = { key: "ABC-9", summary: "a thing", status: "In Progress", category: "indeterminate", mine: true, updated: "2026-10-28T00:00:00Z", url: "https://x/ABC-9", transitions: [] };
  const quiet = quietAgentsByKey([agent({ label: "agent widgets#9" })], { keyOfRef: (r) => (r === "widgets#9" ? "ABC-9" : null) });
  test("a tab name with the key is enough", () => expect(trackerKey("agent ABC-9 cr-x", new Set(["ABC"]))).toBe("ABC-9"));
  test("the issue's item shows its idle agent", () =>
    expect(applyJira([], new Map([["ABC-9", issue]]), { quietAgents: (k) => quiet.get(k) ?? [] })[0].agents.map((a) => a.name)).toEqual(["cr-x"]));
  test("an idle agent alone adds no row", () => expect(groupWorkItems([], [agent()])).toEqual([]));
  test("a finished agent is not quiet", () => expect(quietAgentsByKey([agent({ finishedSeq: 3, label: "agent widgets#9" })], { keyOfRef: () => "ABC-9" }).size).toBe(0));
  test("a moved agent is not quiet", () => expect(quietAgentsByKey([agent()], { agentMoves: new Map([["cr-x", null]]) }).size).toBe(0));

  // A session on someone else's issue stays findable between prompts.
  const theirs: Issue = { ...issue, mine: false };
  const idle = new Map([["ABC-9", [agent()]]]);
  const run = (items: WorkItem[], j?: Issue, quiet = idle) => applyIdleAgents(items, quiet, new Map(j ? [["ABC-9", j]] : []), new Set(["ABC"]));
  test("an idle agent on an issue that isn't the user's keeps its row in Waiting", () => {
    const [it] = run([], theirs);
    expect([it.id, it.key, it.lane, it.why, it.title, it.jira?.status]).toEqual(["a-abc-9", "ABC-9", "waiting", "agent idle", "a thing", "In Progress"]);
    expect(it.agents.map((a) => a.name)).toEqual(["cr-x"]);
  });
  test("an idle agent on an issue the tracker doesn't know keeps its row", () =>
    expect(run([]).map((it) => [it.key, it.keyKind])).toEqual([["ABC-9", "agent"]]));
  test("the user's own issue decides its own row", () => expect(run([], issue)).toEqual([]));
  test("a done issue's idle agent adds no row", () => expect(run([], { ...theirs, category: "done" })).toEqual([]));
  test("an issue already on the board gets no second row", () => {
    const on = applyJira([], new Map([["ABC-9", issue]]), { quietAgents: (k) => idle.get(k) ?? [] });
    expect(run(on, issue).length).toBe(on.length);
  });
  test("a tab that names a PR, not the issue, adds no row", () =>
    expect(run([], theirs, new Map([["ABC-9", [agent({ label: "feedback widgets#9" })]]]))).toEqual([]));
});

describe("wait for a comment", () => {
  const SET = "2026-10-30T12:00:00Z";
  const NOW = Date.parse("2026-10-31T12:00:00Z");
  const comment = (at: string) => ({ id: "1", author: "Sam", isMe: false, at, firstLine: "Looks wrong" });
  const issue = (comments?: Issue["comments"], over: Partial<Issue> = {}): Issue => ({ key: "ABC-1", summary: "s", status: "Code Review", category: "indeterminate", mine: true, updated: SET, url: "u", transitions: [], comments, ...over });
  const run = (j: Issue) => applyCommentWaits([], { "ABC-1": SET }, new Map([[j.key, j]]), {}, NOW);

  test("an issue with no PR stays on the board, in Waiting on others", () => {
    const [it] = run(issue({ lastMyCommentAt: null, lastOtherComment: null }));
    expect([it.lane, it.commentWait?.woke]).toEqual(["waiting", null]);
  });
  test("a comment from before the wait doesn't end it", () =>
    expect(run(issue({ lastMyCommentAt: null, lastOtherComment: comment("2026-10-30T04:00:00-0700") }))[0].lane).toBe("waiting"));
  test("a newer comment by someone else moves it to My turn", () => {
    const [it] = run(issue({ lastMyCommentAt: null, lastOtherComment: comment("2026-10-30T13:00:00.000-0000") }));
    expect([it.lane, it.why]).toEqual(["mine", "Sam commented: “Looks wrong”"]);
  });
  test("the user's reply puts it back", () =>
    expect(run(issue({ lastMyCommentAt: "2026-10-30T14:00:00Z", lastOtherComment: comment("2026-10-30T13:00:00Z") }))[0].lane).toBe("waiting"));
  test("failing Testing after the wait began moves it to My turn", () => {
    const failed = { id: "9", by: "Pat", at: "2026-10-30T13:00:00Z", from: "Testing", to: "To Do", comment: null };
    const testing = { enteredAt: null, failed, lastComment: null, lastMyCommentAt: null, questionSince: null };
    const [it] = run(issue(undefined, { status: "To Do", category: "new", testing }));
    expect([it.lane, it.why]).toEqual(["mine", "Pat moved it from Testing back to To Do"]);
    const old = { ...testing, failed: { ...failed, at: "2026-10-30T09:00:00Z" } };
    expect(run(issue(undefined, { status: "To Do", category: "new", testing: old }))[0].lane).toBe("waiting");
  });
  test("a done issue with a wait doesn't return", () =>
    expect(run(issue(undefined, { category: "done" }))).toEqual([]));
  test("an open PR's lane gives way, and new feedback ends the wait", () => {
    const [base] = groupWorkItems([pr({ title: "ABC-1: x", branch: "feat/abc-1" })], []);
    const j = issue({ lastMyCommentAt: null, lastOtherComment: null });
    const item = { ...base, key: "ABC-1" };
    expect(applyCommentWaits([item], { "ABC-1": SET }, new Map([[j.key, j]]), {}, NOW)[0].lane).toBe("waiting");
    const fed = { ...item, prs: [{ ...item.prs[0], feedback: [{ who: "Kim", at: "2026-10-30T15:00:00Z", kind: "changes", body: "x" } as any] }] };
    expect(applyCommentWaits([fed], { "ABC-1": SET }, new Map([[j.key, j]]), {}, NOW)[0].lane).toBe("mine");
  });
});
