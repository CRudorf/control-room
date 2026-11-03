import { describe, expect, test } from "bun:test";
import type { Agent, Feedback, PrRow, ReviewDrafts } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { feedbackKey, selfReviewKey, tellsFor } from "./tellagents";

const fb = (over: Partial<Feedback>): Feedback => ({ kind: "thread", who: "pat", bot: false, url: "https://github.com/acme/widgets/pull/7#r1", at: "2030-01-02T00:00:00Z", body: "rename this", where: "src/a.ts:3", ...over });
const pr = (feedback: Feedback[], over: Partial<PrRow> = {}): PrRow => ({
  repo: "acme/widgets", number: 7, title: "ABC-1: a change", url: "https://github.com/acme/widgets/pull/7", author: "me", draft: false,
  updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: [], branch: "abc-1-change", base: "main", head: "abc", id: "PR_7",
  merge_state: "BLOCKED", can_merge: "needs approval", review_decision: null, last_activity: "2030-01-01T00:00:00Z", role: "mine",
  state: "address", feedback, rerequest: [], mark: null, superseded: null, ...over,
});
const agent = (over: Partial<Agent> = {}): Agent => ({
  pane: "w1:p1", tab: "w1:t1", workspace: "w1", name: null, label: "ABC-1 fix", title: "", workspaceLabel: "ws", status: "working",
  cwd: "/tmp/x", repo: "widgets", branch: "abc-1-change", session: null, focused: false, seq: 1, finishedSeq: null, ...over,
});

describe("tellsFor", () => {
  const old = fb({ url: "u#old" });
  test("first run tells nothing and remembers what's there", () => {
    const r = tellsFor(groupWorkItems([pr([old])], [agent()]), null);
    expect(r.tells).toEqual([]);
    expect([...r.current]).toEqual([feedbackKey(old)]);
  });
  test("new feedback goes to the PR's agent, one message for all of it", () => {
    const a = fb({ url: "u#a" }), b = fb({ url: "u#b", kind: "changes", who: "sam", where: undefined });
    const r = tellsFor(groupWorkItems([pr([old, a, b])], [agent()]), new Set([feedbackKey(old)]));
    expect(r.tells).toHaveLength(1);
    expect(r.tells[0]).toMatchObject({ pane: "w1:p1", keys: [feedbackKey(a), feedbackKey(b)] });
    expect(r.tells[0].text).toContain("pat commented on acme/widgets#7 (src/a.ts:3): u#a");
    expect(r.tells[0].text).toContain("sam requested changes on acme/widgets#7: u#b");
  });
  test("no message to a blocked agent, about bot summaries, or with no agent", () => {
    const a = fb({ url: "u#a" });
    expect(tellsFor(groupWorkItems([pr([a])], [agent({ status: "blocked" })]), new Set()).tells).toEqual([]);
    expect(tellsFor(groupWorkItems([pr([fb({ bot: true, kind: "comment" })])], [agent()]), new Set()).tells).toEqual([]);
    expect(tellsFor(groupWorkItems([pr([a])]), new Set()).tells).toEqual([]);
  });
  test("a bot's review thread counts", () => {
    expect(tellsFor(groupWorkItems([pr([fb({ bot: true, who: "coderabbitai[bot]" })])], [agent()]), new Set()).tells).toHaveLength(1);
  });
  test("a bot's findings in a review body count", () => {
    expect(tellsFor(groupWorkItems([pr([fb({ bot: true, kind: "review", who: "acme-review-bot" })])], [agent()]), new Set()).tells).toHaveLength(1);
  });
});

describe("self-review findings", () => {
  const drafts = (sha = "abc"): ReviewDrafts => ({ pr: "acme/widgets#7", sha, posted: null, findings: [
    { id: 0, path: "src/a.ts", line: 3, start_line: null, rank: "important", title: "off by one", body: "the loop stops early" },
    { id: 1, path: "src/b.ts", line: 9, start_line: null, rank: "nit", title: "rename", body: "call it on", dismissed: { reason: "matches the API", at: "2030-01-02T00:00:00Z" } },
  ] });
  const reviews = (d = drafts()) => new Map([["acme/widgets#7", d]]);
  const implementer = agent({ status: "idle" });
  const reviewer = agent({ pane: "w1:p2", label: "selfreview widgets#7", status: "idle" });

  test("go to the implementer, not the self-review session, with the open findings only", () => {
    const r = tellsFor(groupWorkItems([pr([])], [reviewer, implementer]), new Set(), new Set(), reviews());
    expect(r.tells).toHaveLength(1);
    expect(r.tells[0]).toMatchObject({ pane: "w1:p1", keys: [selfReviewKey(drafts())] });
    expect(r.tells[0].text).toContain("my self-review of acme/widgets#7 at abc found 1:");
    expect(r.tells[0].text).toContain("important: off by one (src/a.ts:3). the loop stops early");
    expect(r.tells[0].text).not.toContain("rename");
  });
  test("are told once per commit, and again for a new commit's review", () => {
    const told = new Set([selfReviewKey(drafts())]);
    expect(tellsFor(groupWorkItems([pr([])], [implementer]), told, new Set(), reviews()).tells).toEqual([]);
    expect(tellsFor(groupWorkItems([pr([])], [implementer]), told, new Set(), reviews(drafts("def"))).tells).toHaveLength(1);
  });
  test("wait, untold, while only the self-review session is open", () => {
    const r = tellsFor(groupWorkItems([pr([])], [reviewer]), new Set(), new Set(), reviews());
    expect(r.tells).toEqual([]);
    expect(r.current.has(selfReviewKey(drafts()))).toBe(false);
    expect(tellsFor(groupWorkItems([pr([])], [reviewer, implementer]), r.current, new Set(), reviews()).tells).toHaveLength(1);
  });
  test("still go when the review loop watches the PR: the loop doesn't work self-reviews", () => {
    expect(tellsFor(groupWorkItems([pr([])], [implementer]), new Set(), new Set(["acme/widgets#7"]), reviews()).tells).toHaveLength(1);
  });
});
