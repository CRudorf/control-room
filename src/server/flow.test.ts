import { expect, test } from "bun:test";
import type { Agent, PrRow, WorkItem } from "../shared/types";
import { brokenPrompt, conflictsDue, toUpdate, withBroken } from "./broken";
import { HOLD_MS, placesStep } from "./events";
import { decide, QUIET_MS } from "./notify";
import { learned, withReviewers } from "./reviewers";
import { groupWorkItems, lookWhy, nextStep } from "./workitems";

const pr = (o: Partial<PrRow> = {}): PrRow => ({
  repo: "o/gizmo", number: 5, title: "t", url: "u", author: "me", draft: false, updated: "", checks: "success", pending_reviewers: [],
  branch: "b", base: "main", head: "aaa", id: "1", merge_state: "CLEAN", can_merge: "no", review_decision: null, last_activity: "", role: "mine", state: "waiting", feedback: [], ...o,
});
const broken = new Map([["gizmo", { repo: "gizmo", note: "runner image lost webkit", setAt: "" }]]);

test("a failure in a repo with known-broken CI asks nothing of the user", () => {
  const p = withBroken(broken)(pr({ checks: "failure" }));
  expect(p.checks).toBe("known-broken");
  const [it] = groupWorkItems([p], []);
  expect(it.lane).not.toBe("mine");
  expect(it.cells.ci.text).toBe("BRKN");
  expect(withBroken(broken)(pr({ checks: "failure", repo: "o/other" })).checks).toBe("failure");
});

test("agents are told to leave known-broken CI alone", () => {
  expect(brokenPrompt(broken.get("gizmo"))).toContain("known broken right now: runner image lost webkit. Don't rerun it");
  expect(brokenPrompt(undefined)).toBe("");
});

test("once the fix lands, the held-up PRs in that repo update; conflicted and other repos don't", () => {
  const items = groupWorkItems([
    pr({ number: 1, checks: "known-broken" }), pr({ number: 2, merge_state: "BEHIND" }), pr({ number: 3, merge_state: "DIRTY", checks: "failure" }),
    pr({ number: 4, repo: "o/other", checks: "failure" }), pr({ number: 6 }),
  ], []);
  expect(toUpdate(items, "gizmo").map((x) => x.p.number).sort()).toEqual([1, 2]);
});

test("a new conflict gets an agent once per head, not while one is working or the item is parked", () => {
  const dirty = pr({ merge_state: "DIRTY" });
  const [it] = groupWorkItems([dirty], []);
  expect(conflictsDue([it], {}).length).toBe(1);
  expect(conflictsDue([it], { "o/gizmo#5": "aaa" }).length).toBe(0);
  expect(conflictsDue([it], { "o/gizmo#5": "older" }).length).toBe(1);
  expect(conflictsDue([{ ...it, lane: "parked" }], {}).length).toBe(0);
  expect(conflictsDue([{ ...it, agents: [{ status: "working" } as Agent] }], {}).length).toBe(0);
});

test("default reviewers are learned from people re-requested at least twice in a repo", () => {
  const m = learned(["o/gizmo#1 → dev-sam, dev-lee", "o/gizmo#2 → dev-sam", "o/gizmo#3 → dev-lee, dev-kim", "o/other#4 → dev-ann"]);
  expect(m.get("gizmo")).toEqual(["dev-sam", "dev-lee"]);
  expect(m.get("other")).toEqual([]);
});

test("a ready PR with nobody on it asks for the default reviewers; a re-request adds them", () => {
  const ready = withReviewers(pr(), ["dev-sam", "me"]);
  expect(ready.state).toBe("re-request");
  expect(ready.rerequest).toEqual(["dev-sam"]);
  expect(withReviewers(pr({ state: "re-request", rerequest: ["bot"] }), ["dev-sam"]).rerequest).toEqual(["bot", "dev-sam"]);
  expect(withReviewers(pr({ draft: true }), ["dev-sam"]).state).toBe("waiting");
  expect(withReviewers(pr({ pending_reviewers: ["dev-lee"] }), ["dev-sam"]).state).toBe("waiting");
});

test("drafts waiting to go out are their own Next step, before checking agents' work", () => {
  const [it] = groupWorkItems([pr({ role: "requested", author: "pat" })], [], undefined, undefined, new Map([["o/gizmo#5", 2]]));
  expect(it.primary.act).toBe("curate");
  expect(nextStep(it)).toBe("post");
});

const item = (lane: WorkItem["lane"], step: string | null) => ({ id: "i", lane, next: step ? { rank: 1, step } : undefined } as unknown as WorkItem);

test("a lane flip that reverts within a minute is never logged", () => {
  const t0 = "2030-01-01T00:00:00.000Z", t1 = "2030-01-01T00:00:20.000Z", t2 = "2030-01-01T00:00:40.000Z";
  let s = placesStep([item("waiting", null)], null, {}, t0);
  s = placesStep([item("mine", "check")], s.last, s.pending, t1);
  expect(s.rows).toEqual([]);
  s = placesStep([item("waiting", null)], s.last, s.pending, t2);
  expect(s.rows).toEqual([]);
  expect(s.pending).toEqual({});
});

test("a move that holds is logged once, at the time it started", () => {
  const t0 = "2030-01-01T00:00:00.000Z", t1 = "2030-01-01T00:00:10.000Z", t2 = new Date(Date.parse(t1) + HOLD_MS).toISOString();
  let s = placesStep([item("waiting", null)], null, {}, t0);
  s = placesStep([item("mine", "check")], s.last, s.pending, t1);
  s = placesStep([item("mine", "check")], s.last, s.pending, t2);
  expect(s.rows).toEqual([[t1, "i", "move", "mine", "check", JSON.stringify({ lane: "waiting", step: null })]]);
  expect(placesStep([item("mine", "check")], s.last, s.pending, t2).rows).toEqual([]);
});

test("an agent that finishes again within half an hour doesn't notify on its own", () => {
  const agent = (seq: number) => ({ pane: "p1", tab: "t", workspace: "w", name: "cr-x", label: "agent X-1", title: "", workspaceLabel: "", status: "done", cwd: "", repo: null, branch: null, session: null, focused: false, seq, finishedSeq: seq } as Agent);
  const items = (seq: number) => groupWorkItems([], [agent(seq)]);
  const now = 1_000_000_000;
  const first = decide(items(1), new Set(), "b/", { now, lastDone: {} });
  expect(first.notes).toHaveLength(1);
  const again = decide(items(2), first.seen, "b/", { now: now + 60_000, lastDone: first.lastDone! });
  expect(again.notes).toHaveLength(0);
  const later = decide(items(3), again.seen, "b/", { now: now + QUIET_MS + 1, lastDone: again.lastDone! });
  expect(later.notes).toHaveLength(1);
});

test("a look item says what there is to decide", () => {
  expect(lookWhy({ prs: [], agents: [{}], branches: [] } as unknown as WorkItem)).toContain("its agent stopped without a PR");
  expect(lookWhy({ prs: [pr({ draft: true })], agents: [] } as unknown as WorkItem)).toContain("#5 is a draft");
});
