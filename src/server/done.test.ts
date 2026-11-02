import { describe, expect, test } from "bun:test";
import type { PrFacts } from "./metrics";
import { spans, summarize, type ActionRow, type Review } from "./done";
import { DEFAULT_COEFFS, type Turn } from "./tokens";

const fact = (over: Partial<PrFacts>): PrFacts => ({
  ref: "acme/widgets#1", repo: "acme/widgets", number: 1, title: "ABC-1: a change", url: "https://github.com/acme/widgets/pull/1", feature: "ABC-1",
  created: "2030-01-01T10:00:00Z", merged: null, closed: null, feedback: [], rounds: 0, commits: [], ...over,
});
const review = (state: string, at: string): Review => ({ ref: "acme/gadgets#9", url: "u", title: "their change", author: "sam", state, at });
const turn: Turn = { id: "m1", at: "2030-01-10T12:00:00Z", session: "s1", model: "claude-opus-5-5", dir: "/x", branch: "b", input: 1e6, output: 0, read: 0, write5m: 0, write1h: 0 };

describe("summarize", () => {
  const FROM = "2030-01-10T00:00:00Z";
  const facts = [
    fact({ ref: "acme/widgets#1", merged: "2030-01-10T09:00:00Z", commits: [{ oid: "a", at: "2030-01-09T09:00:00Z" }, { oid: "b", at: "2030-01-10T08:00:00Z" }] }),
    fact({ ref: "acme/tools#2", repo: "acme/tools", feature: "ABC-2", created: "2030-01-10T11:00:00Z" }),
    fact({ ref: "acme/widgets#3", feature: "ABC-3", created: "2030-01-02T00:00:00Z", closed: "2030-01-10T01:00:00Z" }),
    fact({ ref: "acme/widgets#4", feature: "ABC-4", merged: "2030-01-08T00:00:00Z" }),
  ];
  const reviews = [review("COMMENTED", "2030-01-10T01:00:00Z"), review("COMMENTED", "2030-01-10T02:00:00Z"), review("APPROVED", "2030-01-10T03:00:00Z"), review("APPROVED", "2030-01-01T00:00:00Z")];
  const records: ActionRow[] = [
    { at: "2030-01-10T05:00:00Z", action: "reply", trigger: "detail", sent: "x" },
    { at: "2030-01-10T05:00:00Z", action: "jira-transition", trigger: "suggested", sent: "ABC-1 → Done" },
    { at: "2030-01-09T05:00:00Z", action: "reply", trigger: "detail", sent: "y" },
    { at: "2030-01-10T06:00:00Z", action: "post-review", trigger: "curation", sent: "acme/gadgets#9: 3 comment(s), comment" },
    { at: "2030-01-10T07:00:00Z", action: "resolve", trigger: "detail", sent: "x" },
  ];
  const s = summarize("today", FROM, facts, reviews, records, [turn], DEFAULT_COEFFS);

  test("counts only what happened in the span", () => {
    expect(s.merged.map((x) => x.ref)).toEqual(["acme/widgets#1"]);
    expect(s.opened.map((x) => x.ref)).toEqual(["acme/tools#2"]);
    expect(s.closed.map((x) => x.ref)).toEqual(["acme/widgets#3"]);
    expect(s.commits).toBe(1);
    expect(s.repos).toEqual(["tools", "widgets"]);
    expect(s.features.sort()).toEqual(["ABC-1", "ABC-2"]);
    expect(s.replies).toBe(1);
    expect([s.reviewsPosted, s.commentsPosted, s.resolved]).toEqual([1, 3, 1]);
    expect(s.jira).toEqual(["ABC-1 → Done"]);
  });

  test("a reviewed PR shows its verdict, its comment reviews folded in", () => {
    expect(s.reviewed).toEqual([{ ref: "acme/gadgets#9", url: "u", title: "their change", author: "sam", verdict: "approved", comments: 2 }]);
  });

  test("prices the span's AI usage", () => {
    expect(s.usage?.usd).toBeCloseTo(4);
    expect(s.usage?.sessions).toBe(1);
  });
});

test("spans start at midnight, and 1, 7 and 30 days back", () => {
  const now = new Date("2030-01-10T15:00:00");
  const [[, today], [, day], [, week], [, month]] = spans(now);
  expect(new Date(today).getHours()).toBe(0);
  expect(Date.parse(day)).toBe(now.getTime() - 86_400_000);
  expect(Date.parse(week)).toBe(now.getTime() - 7 * 86_400_000);
  expect(Date.parse(month)).toBe(now.getTime() - 30 * 86_400_000);
});
