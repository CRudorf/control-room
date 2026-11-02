import { describe, expect, test } from "bun:test";
import { factsOf, features, friction, historyNotReady, median, quality, stageTimes, weekly, weekOf, type PrFacts } from "./metrics";

const user = (login: string) => ({ __typename: "User", login });
const bot = (login: string) => ({ __typename: "Bot", login });
const commit = (oid: string, at: string, login = "me", parents = 1) =>
  ({ commit: { oid, committedDate: at, parents: { totalCount: parents }, authors: { nodes: [{ user: { login } }] } } });

function node(over: object = {}) {
  return {
    number: 7, title: "ABC-12: a change", url: "https://github.com/acme/widgets/pull/7", createdAt: "2030-01-07T15:00:00",
    mergedAt: null, closedAt: null, headRefName: "abc-12-thing", repository: { nameWithOwner: "acme/widgets" },
    reviews: { nodes: [] }, reviewThreads: { nodes: [] }, comments: { nodes: [] }, commits: { nodes: [] }, ...over,
  };
}

describe("facts", () => {
  test("feedback, rounds and Pat's own non-merge commits", () => {
    const f = factsOf(node({
      reviews: { nodes: [
        { state: "CHANGES_REQUESTED", submittedAt: "2030-01-08T10:00:00", author: user("pat"), commit: { oid: "a" } },
        { state: "APPROVED", submittedAt: "2030-01-09T10:00:00", author: user("pat"), commit: { oid: "b" } },
        { state: "COMMENTED", submittedAt: "2030-01-09T11:00:00", author: bot("coderabbitai"), commit: { oid: "c" } },
      ] },
      reviewThreads: { nodes: [
        { comments: { nodes: [{ createdAt: "2030-01-08T10:00:00", author: bot("coderabbitai") }] } },
        { comments: { nodes: [{ createdAt: "2030-01-08T10:00:00", author: user("me") }] } },
      ] },
      comments: { nodes: [{ createdAt: "2030-01-08T09:00:00", author: bot("github-actions") }, { createdAt: "2030-01-08T09:00:00", author: user("sam") }] },
      commits: { nodes: [commit("a", "2030-01-07T15:00:00"), commit("m", "2030-01-08T15:00:00", "me", 2), commit("x", "2030-01-08T16:00:00", "pat")] },
    }), "me");
    expect(f.feature).toBe("ABC-12");
    expect(f.feedback.map((x) => `${x.who}:${x.kind}`).sort()).toEqual(["coderabbitai:thread", "pat:changes", "sam:comment"]);
    expect(f.rounds).toBe(2);
    expect(f.commits.map((c) => c.oid)).toEqual(["a"]);
  });
  test("a closed PR that merged counts as merged, not closed", () => {
    const f = factsOf(node({ mergedAt: "2030-01-09T10:00:00", closedAt: "2030-01-09T10:00:00" }), "me");
    expect([f.merged, f.closed]).toEqual(["2030-01-09T10:00:00", null]);
  });
  test("size is lines added plus removed, left out when GitHub sends none", () => {
    expect(factsOf(node({ additions: 40, deletions: 12 }), "me").size).toBe(52);
    expect(factsOf(node({}), "me").size).toBeUndefined();
  });
});

const pr = (over: Partial<PrFacts>): PrFacts => ({
  ref: "acme/widgets#1", repo: "acme/widgets", number: 1, title: "t", url: "u", feature: "ABC-1",
  created: "2030-01-07T15:00:00", merged: null, closed: null, feedback: [], rounds: 0, commits: [], ...over,
});

describe("weekly", () => {
  test("weeks start Monday", () => {
    expect(weekOf("2030-01-13T23:00:00")).toBe("2030-01-07"); // Sunday
    expect(weekOf("2030-01-14T01:00:00")).toBe("2030-01-14");
  });
  test("activity lands in the week it happened", () => {
    const ws = weekly([
      pr({ merged: "2030-01-15T10:00:00", rounds: 2, commits: [{ oid: "a", at: "2030-01-08T10:00:00" }],
        feedback: [{ at: "2030-01-14T10:00:00", who: "pat", bot: false, kind: "thread" }, { at: "2030-01-14T10:00:00", who: "b", bot: true, kind: "thread" }] }),
      pr({ ref: "acme/gadgets#2", repo: "acme/gadgets", feature: "ABC-2", created: "2030-01-15T10:00:00", closed: "2030-01-16T10:00:00" }),
    ], "2030-01-01");
    expect(ws.map((w) => [w.week, w.opened, w.merged, w.closed, w.commits, w.feedback, w.humanFeedback])).toEqual([
      ["2030-01-07", 1, 0, 0, 1, 0, 0], ["2030-01-14", 1, 1, 1, 0, 2, 1],
    ]);
    expect(ws[1].rounds).toEqual([2]);
    expect(ws[1].sizes).toEqual([]);
    expect(weekly([pr({ merged: "2030-01-15T10:00:00", size: 120 }), pr({ merged: "2030-01-16T10:00:00", size: 30 })], "2030-01-01").at(-1)!.sizes).toEqual([120, 30]);
    expect(ws[1].repos).toEqual(["gadgets", "widgets"]);
    expect(features([pr({})], "2030-01-01")[0]).toMatchObject({ key: "ABC-1", prs: 1 });
  });
  test("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("friction", () => {
  test("time on My turn, and what happened in Next", () => {
    const e = (at: string, item: string, kind: string, lane: string | null = null, step: string | null = null) => ({ at, item, kind, lane, step, detail: null });
    const fs = friction([
      e("2030-01-07T09:00:00", "a", "arrive", "mine"),
      e("2030-01-07T12:00:00", "a", "move", "waiting"),
      e("2030-01-08T09:00:00", "b", "arrive", "mine"),
      e("2030-01-08T10:00:00", "b", "move", "mine", "quick"),
      e("2030-01-08T11:00:00", "b", "leave"),
      e("2030-01-08T10:00:00", "b", "next-done", null, "quick"),
      e("2030-01-08T10:05:00", "c", "next-skip", null, "start"),
      e("2030-01-08T10:06:00", "c", "next-done", null, "nudge"),
    ], "2030-01-01");
    expect(fs).toEqual([{ week: "2030-01-07", myTurnHours: [3, 2], nextDone: 2, nextSkipped: 1, nudges: 1 }]);
  });
});

describe("historyNotReady", () => {
  const now = Date.parse("2030-01-08T12:00:00Z");
  test("never synced, synced over a day ago, synced within a day", () => {
    expect(historyNotReady(null, now)).toBe("PR history hasn't synced yet");
    expect(historyNotReady("2030-01-07T11:00:00Z", now)).toBe("PR history last synced 2030-01-07T11:00:00Z");
    expect(historyNotReady("2030-01-08T06:00:00Z", now)).toBeNull();
  });
});

describe("stage times", () => {
  const pr = (over: object) => factsOf(node({
    commits: { nodes: [commit("c1", "2030-01-07T09:00:00Z")] }, createdAt: "2030-01-07T10:00:00Z",
    timelineItems: { nodes: [
      { __typename: "ReadyForReviewEvent", createdAt: "2030-01-07T12:00:00Z" },
      { __typename: "ReviewRequestedEvent", createdAt: "2030-01-07T12:00:00Z", requestedReviewer: { __typename: "User", login: "pat" } },
      { __typename: "ReviewRequestedEvent", createdAt: "2030-01-07T12:00:00Z", requestedReviewer: { __typename: "Team", slug: "platform-devs" } },
    ] },
    ...over,
  }), "me");

  test("splits a merged PR's time into coding, waiting, in review and merging", () => {
    const p = pr({
      mergedAt: "2030-01-09T14:00:00Z",
      reviews: { nodes: [
        { state: "COMMENTED", submittedAt: "2030-01-08T00:00:00Z", author: user("pat"), commit: { oid: "c1" } },
        { state: "APPROVED", submittedAt: "2030-01-09T12:00:00Z", author: user("pat"), commit: { oid: "c1" } },
        { state: "COMMENTED", submittedAt: "2030-01-07T13:00:00Z", author: bot("coderabbitai"), commit: { oid: "c1" } },
      ] },
    });
    const s = stageTimes([p], "2030-01-01");
    // Coding from the first commit to ready (3h, the draft time counts), first person's review 12h later.
    expect(s.medians).toEqual({ coding: 3, waitFirst: 12, inReview: 36, toMerge: 2, total: 53 });
    expect(s.reviewers).toEqual([
      { who: "pat", asks: 1, answered: 1, median: 12, open: 0 },
      { who: "team:platform-devs", asks: 1, answered: 1, median: 12, open: 0 },
    ]);
  });

  test("an open PR's unanswered requests are what's waited on now", () => {
    const s = stageTimes([pr({})], "2030-01-01", Date.parse("2030-01-08T12:00:00Z"));
    expect(s.prs).toBe(0);
    expect(s.waiting.map((w) => [w.who, w.hours])).toEqual([["pat", 24], ["team:platform-devs", 24]]);
    expect(s.reviewers.map((r) => r.open)).toEqual([1, 1]);
  });
});

describe("quality", () => {
  const FROM = "2030-01-01T00:00:00Z";
  const base = { ref: "a/b#1", repo: "a/b", number: 1, title: "t", url: "u", feature: "F", created: "2030-01-06T00:00:00Z", closed: null, feedback: [], rounds: 1, commits: [] };
  test("counts CI-failed merges, agents and Pat's touches, loop outcomes and shipped states by week", () => {
    const q = quality(
      [{ ...base, merged: "2030-01-07T10:00:00Z", ciFailed: 2 }, { ...base, ref: "a/b#2", merged: "2030-01-08T10:00:00Z", ciFailed: 0 }],
      [
        { at: "2030-01-07T11:00:00Z", action: "start-agent", sent: "selfreview b#1", result: "started" },
        { at: "2030-01-07T11:05:00Z", action: "start-agent", sent: "feedback b#2", result: "failed: no clone" },
        { at: "2030-01-07T12:00:00Z", action: "type-agent", sent: "x", result: "sent" },
        { at: "2030-01-07T12:01:00Z", action: "keys-agent", sent: "x", result: "sent" },
        { at: "2030-01-07T13:00:00Z", action: "loop-report", sent: "a/b#2", result: '{"head":"abc","summary":"fixed"}' },
        { at: "2030-01-07T13:00:00Z", action: "loop-report", sent: "a/b#2", result: '{"head":null,"summary":"nothing"}' },
        { at: "2030-01-07T13:01:00Z", action: "loop-report", sent: "a/b#2", result: "loop running" },
        { at: "2030-01-08T13:00:00Z", action: "loop-stop", sent: "a/b#2", result: "high risk" },
      ],
      [{ merged: "2030-01-07T10:00:00Z", state: "broke", verdict: { verdict: "caused", why: "", by: "you", at: "" } }, { merged: "2030-01-08T10:00:00Z", state: "clean", verdict: { verdict: "not", why: "", by: "you", at: "" } }],
      FROM,
    );
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ merged: 2, ciFailedPrs: 1, agents: 1, selfReviews: 1, touches: 2, loopRounds: 2, loopPushed: 1, loopStops: 1, shipped: { clean: 1, broke: 1, watching: 0, changed: 0, look: 0 }, confirmed: 1, dismissed: 1 });
  });
});
