import { describe, expect, test } from "bun:test";
import type { Agent, Feedback, PrRow } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { applyLoop, decide, feedbackKey, MAX_ROUNDS, views, type Ctx, type Loops } from "./cycle";
import { classify, describe as describeFlags, type Flag } from "./risk";

const fb = (over: Partial<Feedback> = {}): Feedback => ({ kind: "thread", who: "pat", bot: false, url: "https://github.com/acme/widgets/pull/7#r1", at: "2030-01-02T00:00:00Z", body: "rename this", where: "src/a.ts:3", thread_id: "T1", reply_to: 11, ...over });
const pr = (over: Partial<PrRow> = {}): PrRow => ({
  repo: "acme/widgets", number: 7, title: "ABC-1: a change", url: "https://github.com/acme/widgets/pull/7", author: "me", draft: false,
  updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: [], branch: "abc-1-change", base: "main", head: "h1", id: "PR_7",
  merge_state: "BLOCKED", can_merge: "needs approval", review_decision: null, last_activity: "2030-01-01T00:00:00Z", role: "mine",
  state: "waiting", feedback: [], rerequest: [], mark: null, superseded: null, ...over,
});
const agent = (over: Partial<Agent> = {}): Agent => ({
  pane: "w1:p1", tab: "w1:t1", workspace: "w1", name: "cr-widgets-7", label: "feedback widgets#7", title: "", workspaceLabel: "ws", status: "idle",
  cwd: "/tmp/x", repo: "widgets", branch: "abc-1-change", session: null, focused: false, seq: 1, finishedSeq: null, ...over,
});
const NOW = Date.parse("2030-01-03T00:00:00Z");
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ now: NOW, reports: new Map(), risk: () => [], first: false, lowMemory: false, ...over });
const REF = "acme/widgets#7";
const run = (p: PrRow, loops: Loops = {}, c: Partial<Ctx> = {}, agents: Agent[] = []) => decide(groupWorkItems([p], agents), loops, ctx(c));

describe("decide", () => {
  test("the first pass takes what's on the board as its baseline and does nothing", () => {
    const r = run(pr({ state: "address", feedback: [fb()], checks: "failure" }), {}, { first: true });
    expect(r.steps).toEqual([]);
    expect(r.loops[REF].seen).toEqual([feedbackKey(fb())]);
    expect(r.loops[REF].ciSeen).toEqual(["h1"]);
  });

  test("a new PR's feedback starts a round in a new agent", () => {
    const r = run(pr({ state: "address", feedback: [fb()] }));
    expect(r.steps).toEqual([{ do: "round", ref: REF, item: expect.any(String), kind: "feedback", pane: null }]);
    expect(r.loops[REF].round).toMatchObject({ kind: "feedback", head: "h1", started: true });
    expect(r.loops[REF].seen).toContain(feedbackKey(fb()));
  });

  test("an idle agent on the branch gets the round instead", () => {
    const r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    expect(r.steps[0]).toMatchObject({ do: "round", pane: "w1:p1" });
  });

  test("the session in a tab named for the PR gets the next round, whatever branch its worktree is on", () => {
    const r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent({ branch: "pr7-work", upstream: null, head: null, pane: "w1:p9" })]);
    expect(r.steps[0]).toMatchObject({ do: "round", pane: "w1:p9" });
  });

  test("a working agent on the item means hands off", () => {
    expect(run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent({ status: "working" })]).steps).toEqual([]);
  });

  test("failing CI: update when behind, else rerun, then an agent", () => {
    const failing = pr({ checks: "failure", merge_state: "BEHIND" });
    let r = run(failing);
    expect(r.steps[0]).toMatchObject({ do: "update" });
    r = run(pr({ checks: "failure" }), r.loops);
    expect(r.steps[0]).toMatchObject({ do: "rerun" });
    r = run(pr({ checks: "failure" }), r.loops);
    expect(r.steps[0]).toMatchObject({ do: "round", kind: "ci" });
  });

  test("CI still failing on the loop's own push stops it", () => {
    const loops = run(pr()).loops;
    loops[REF].agentHeads = ["h2"];
    loops[REF].reran = ["h2"];
    const r = run(pr({ head: "h2", checks: "failure" }), loops);
    expect(r.steps).toEqual([]);
    expect(r.loops[REF].stop?.why).toContain("still fails");
  });

  test("high-risk files stop it before any agent starts", () => {
    const flags: Flag[] = [{ category: "migration", file: "app/migrations/0042_add.py" }];
    const r = run(pr({ state: "address", feedback: [fb()] }), {}, { risk: () => flags });
    expect(r.steps).toEqual([]);
    expect(r.loops[REF].stop).toMatchObject({ why: "high risk: migration (app/migrations/0042_add.py)", risk: true });
  });

  test("files Pat let it past don't stop it again", () => {
    const loops = run(pr()).loops;
    loops[REF].approved = ["app/migrations/0042_add.py"];
    const r = run(pr({ state: "address", feedback: [fb()] }), loops, { risk: () => [{ category: "migration", file: "app/migrations/0042_add.py" }] });
    expect(r.steps[0]).toMatchObject({ do: "round" });
  });

  test("waits while the risk check runs", () => {
    expect(run(pr({ state: "address", feedback: [fb()] }), {}, { risk: () => undefined }).steps).toEqual([]);
  });

  test("stops after the round cap", () => {
    const loops = run(pr()).loops;
    loops[REF].rounds = MAX_ROUNDS;
    const r = run(pr({ state: "address", feedback: [fb()] }), loops);
    expect(r.loops[REF].stop?.why).toContain(`${MAX_ROUNDS} rounds`);
  });

  test("a second changes request from the same person stops it", () => {
    const loops = run(pr()).loops;
    loops[REF].changesFrom = ["sam"];
    const r = run(pr({ state: "address", feedback: [fb({ kind: "changes", who: "sam", url: "u#c2" })] }), loops);
    expect(r.loops[REF].stop?.why).toBe("sam requested changes again");
  });

  test("new agents wait for room", () => {
    const busy: Loops = Object.fromEntries([1, 2, 3].map((n) => [`acme/x#${n}`, { ...run(pr()).loops[REF], round: { kind: "feedback", at: "2030-01-03T00:00:00Z", head: "h", pane: "p", agent: "a", started: true, keys: [], changes: [] } }]));
    expect(run(pr({ state: "address", feedback: [fb()] }), busy).steps).toEqual([]);
    expect(run(pr({ state: "address", feedback: [fb()] }), {}, { lowMemory: true }).steps).toEqual([]);
  });

  test("a report closes the round: bots answered, people's replies held, reviewers asked once they're sent", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    const reports = new Map([[REF, { head: "h2", checks: [{ cmd: "bun test", exit: 0 }], replies: [{ reply_to: 11, thread_id: "T1", who: "pat", body: "Renamed.", resolve: true }] }]]);
    r = run(pr({ head: "h2", state: "address", feedback: [fb()] }), r.loops, { reports }, [agent()]);
    expect(r.loops[REF].round).toBeUndefined();
    expect(r.loops[REF].rounds).toBe(1);
    expect(r.loops[REF].held).toMatchObject({ head: "h2", who: ["pat"] });
    expect(r.loops[REF].stop).toBeUndefined();
    expect(r.steps).toEqual([]);
    // Pat sent them: the thread's last word is his, so it leaves the feedback.
    r = run(pr({ head: "h2", state: "waiting", feedback: [] }), r.loops, {}, [agent()]);
    expect(r.loops[REF].held).toBeUndefined();
  });

  test("feedback answered without a push closes the round and keeps watching", () => {
    let r = run(pr({ state: "address", feedback: [fb({ who: "coderabbitai", bot: true })] }), {}, {}, [agent()]);
    r = run(pr({ state: "waiting", feedback: [] }), r.loops, { reports: new Map([[REF, { head: null, summary: "answered the bot, no change needed" }]]) }, [agent()]);
    expect(r.loops[REF].round).toBeUndefined();
    expect(r.loops[REF].stop).toBeUndefined();
  });

  test("a pushed fix with a passing check counts as done, and the board shows its checks", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    const checks = [{ cmd: "bunx tsc --noEmit", exit: 0 }, { cmd: "bun test", exit: 0 }];
    r = run(pr({ head: "h2", state: "waiting" }), r.loops, { reports: new Map([[REF, { head: "h2", checks }]]) }, [agent()]);
    expect(r.loops[REF].stop).toBeUndefined();
    expect(r.loops[REF].rounds).toBe(1);
    const items = groupWorkItems([pr({ head: "h2" })]);
    expect(views(items, r.loops).get(REF)?.checks).toEqual(checks);
  });

  test("a pushed fix with no passing check goes back to Pat", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    const round = r.loops;
    r = run(pr({ head: "h2", state: "waiting" }), round, { reports: new Map([[REF, { head: "h2", checks: [{ cmd: "bun test", exit: 1 }] }]]) }, [agent()]);
    expect(r.loops[REF].stop?.why).toBe("agent pushed a fix with no passing check: bun test exited 1");
    r = run(pr({ head: "h2", state: "waiting" }), round, { reports: new Map([[REF, { head: "h2", checks: [] }]]) }, [agent()]);
    expect(r.loops[REF].stop?.why).toBe("agent pushed a fix with no passing check");
    const [it] = applyLoop(groupWorkItems([pr({ head: "h2" })], [agent()]), views(groupWorkItems([pr({ head: "h2" })], [agent()]), r.loops));
    expect(it.lane).toBe("mine");
    expect(it.primary).toMatchObject({ label: "Check the loop's agent" });
  });

  test("an older agent's report with no checks field is handed back the same when it pushed", () => {
    let r = run(pr({ checks: "failure" }));
    r = run(pr({ checks: "failure" }), r.loops);
    r = run(pr({ checks: "failure" }), r.loops, {}, [agent()]);
    r = run(pr({ head: "h2", checks: "pending" }), r.loops, { reports: new Map([[REF, { head: "h2", summary: "fixed the fixture" }]]) }, [agent()]);
    expect(r.loops[REF].stop?.why).toBe("agent pushed a fix with no passing check");
  });

  test("a report that pushed nothing needs no checks", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    r = run(pr({ state: "waiting" }), r.loops, { reports: new Map([[REF, { head: "h1", summary: "answered, no change needed" }]]) }, [agent()]);
    expect(r.loops[REF].stop).toBeUndefined();
  });

  test("a CI round that pushes nothing stops it", () => {
    let r = run(pr({ checks: "failure" }));
    r = run(pr({ checks: "failure" }), r.loops);
    r = run(pr({ checks: "failure" }), r.loops, {}, [agent()]);
    expect(r.loops[REF].round).toMatchObject({ kind: "ci" });
    r = run(pr({ checks: "failure" }), r.loops, { reports: new Map([[REF, { head: null, summary: "the fixture is wrong" }]]) }, [agent()]);
    expect(r.loops[REF].stop?.why).toBe("agent couldn't fix CI: the fixture is wrong");
  });

  test("a stacked PR behind its parent takes the parent's latest, once per parent head", () => {
    const loops = run(pr()).loops;
    const stacked = pr({ stack: { on: "acme/widgets#6", number: 6, branch: "abc-1-base", head: "p2", behind: true } });
    let r = run(stacked, loops);
    expect(r.steps).toEqual([{ do: "restack", ref: REF, item: expect.any(String), on: "acme/widgets#6", branch: "abc-1-base" }]);
    r = run(stacked, r.loops);
    expect(r.steps).toEqual([]);
  });

  test("a report asking for a decision stops it", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    r = run(pr({ state: "address", feedback: [fb()] }), r.loops, { reports: new Map([[REF, { head: "h2", ask: "Keep the old endpoint?" }]]) }, [agent()]);
    expect(r.loops[REF].stop?.why).toBe("agent needs a decision: Keep the old endpoint?");
  });

  test("an agent that stops without a report stops the loop", () => {
    let r = run(pr({ state: "address", feedback: [fb()] }), {}, {}, [agent()]);
    r.loops[REF].round!.at = "2030-01-02T23:00:00Z";
    r = run(pr({ state: "address", feedback: [fb()] }), r.loops, {}, [agent({ status: "done" })]);
    expect(r.loops[REF].stop?.why).toContain("stopped without a report");
  });

  test("re-requests once CI is green after the push", () => {
    const loops = run(pr()).loops;
    const p = pr({ head: "h2", state: "re-request", rerequest: ["sam"] });
    let r = run(p, loops);
    expect(r.steps[0]).toEqual({ do: "rerequest", ref: REF, item: expect.any(String), who: ["sam"] });
    r = run(p, r.loops);
    expect(r.steps).toEqual([]);
    expect(run(pr({ head: "h3", state: "re-request", rerequest: ["sam"], checks: "pending" }), loops).steps).toEqual([]);
  });

  test("leaves drafts, parked and off PRs alone", () => {
    expect(run(pr({ draft: true, state: "address", feedback: [fb()] })).steps).toEqual([]);
    const loops = run(pr()).loops;
    loops[REF].off = true;
    expect(run(pr({ state: "address", feedback: [fb()] }), loops).steps).toEqual([]);
  });
});

describe("applyLoop", () => {
  test("a stop puts the item in My turn with a way to look", () => {
    const items = groupWorkItems([pr()]);
    const loops = run(pr()).loops;
    loops[REF].stop = { why: "high risk: auth (src/auth.py)", at: "x", risk: true };
    const [it] = applyLoop(items, views(items, loops));
    expect(it.lane).toBe("mine");
    expect(it.why).toContain("loop stopped on widgets#7: high risk");
    expect(it.primary).toMatchObject({ url: "https://github.com/acme/widgets/pull/7/files" });
  });

  test("drafted replies ask to be sent", () => {
    const items = groupWorkItems([pr()]);
    const loops = run(pr()).loops;
    loops[REF].held = { head: "h1", replies: [{ reply_to: 11, thread_id: "T1", who: "pat", body: "Done.", resolve: true }], who: ["pat"] };
    const [it] = applyLoop(items, views(items, loops));
    expect(it.primary).toMatchObject({ act: "replies", label: "Send 1 drafted reply on widgets#7" });
  });
});

describe("risk", () => {
  const f = (filename: string, added = "") => ({ filename, patch: added ? `@@ -1 +1 @@\n+${added}` : "" });
  test("flags migrations, auth, money, PHI, infra and dependency changes", () => {
    const flags = classify([
      f("accounts/migrations/0042_points.py"), f("api/permissions.py"), f("billing/invoice.py"), f("core/views.py", "member_id = row.member_id"),
      f("terraform/main.tf"), f("requirements.txt"), f("core/utils.py", "return x + 1"),
    ], "acme/widgets");
    expect(flags.map((x) => x.category).sort()).toEqual(["auth", "dependencies", "infra", "migration", "money", "phi"]);
  });
  test("per-repo tuning skips paths and adds its own", () => {
    const tune = { widgets: { skip: ["^billing/"], paths: { money: ["^ledgerish/"] } } };
    expect(classify([f("billing/invoice.py"), f("ledgerish/x.py")], "acme/widgets", tune)).toEqual([{ category: "money", file: "ledgerish/x.py" }]);
  });
  test("describes flags by category", () => {
    expect(describeFlags([{ category: "auth", file: "a" }, { category: "auth", file: "b" }, { category: "phi", file: "c" }])).toBe("auth (2 files), phi (c)");
  });
});
