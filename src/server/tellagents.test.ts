import { describe, expect, test } from "bun:test";
import type { Agent, Feedback, PrRow } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { feedbackKey, tellsFor } from "./tellagents";

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
});
