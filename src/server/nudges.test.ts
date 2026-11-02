import { describe, expect, test } from "bun:test";
import type { PrRow } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { nudgeText, staleNudges, weekdaysSince } from "./nudges";

let n = 100;
function pr(over: Partial<PrRow>): PrRow {
  n++;
  return {
    repo: "acme/widgets", number: n, title: `ABC-${n}: a change`, url: `https://github.com/acme/widgets/pull/${n}`,
    author: "me", draft: false, updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: ["pat"],
    branch: `branch-${n}`, base: "main", head: "abc", id: `PR_${n}`, merge_state: "BLOCKED", can_merge: "needs approval",
    review_decision: "REVIEW_REQUIRED", last_activity: "2030-01-07T15:00:00", waiting_since: "2030-01-07T15:00:00",
    role: "mine", state: "waiting", feedback: [], rerequest: [], mark: null, superseded: null, ...over,
  };
}

// Local times: 2030-01-07 is a Monday.
const at = (d: string) => Date.parse(`${d}T10:00:00`);

describe("weekdays", () => {
  test("weekends don't count", () => {
    expect(weekdaysSince("2030-01-11T15:00:00", at("2030-01-14"))).toBe(1); // Fri → Mon
    expect(weekdaysSince("2030-01-11T15:00:00", at("2030-01-15"))).toBe(2); // Fri → Tue
    expect(weekdaysSince("2030-01-07T15:00:00", at("2030-01-09"))).toBe(2); // Mon → Wed
    expect(weekdaysSince("2030-01-07T15:00:00", at("2030-01-07"))).toBe(0);
  });
});

describe("stale nudges", () => {
  test("one nudge per reviewer, covering all of their stale PRs", () => {
    const items = groupWorkItems([
      pr({ pending_reviewers: ["pat", "sam"] }),
      pr({ pending_reviewers: ["pat"], waiting_since: "2030-01-08T09:00:00" }),
      pr({ pending_reviewers: ["pat"], waiting_since: "2030-01-10T09:00:00" }), // fresh
    ]);
    const ns = staleNudges(items, new Map(), at("2030-01-10"));
    expect(ns.map((x) => [x.reviewer, x.prs.length])).toEqual([["pat", 2], ["sam", 1]]);
    expect(ns[0].text).toContain("these");
    expect(ns[0].text.split("\n")).toHaveLength(3);
  });
  test("teams, bots, drafts, parked work and PRs that need Pat stay out", () => {
    const items = groupWorkItems([
      pr({ pending_reviewers: ["@platform", "copilot-pull-request-reviewer[bot]"] }),
      pr({ draft: true }),
      pr({ state: "address" }),
    ]);
    const parked = groupWorkItems([pr({})]).map((i) => ({ ...i, lane: "parked" as const }));
    expect(staleNudges([...items, ...parked], new Map(), at("2030-01-10"))).toEqual([]);
  });
  test("a nudge restarts the clock", () => {
    const p = pr({});
    const items = groupWorkItems([p]);
    const nudged = new Map([[`${p.repo}#${p.number}|pat`, "2030-01-09T12:00:00"]]);
    expect(staleNudges(items, nudged, at("2030-01-10"))).toEqual([]);
    expect(staleNudges(items, nudged, at("2030-01-11"))).toHaveLength(1);
  });
  test("the message only asks, then links", () => {
    expect(nudgeText([{ url: "https://x/1" }])).toBe("could you take a look at this one when you get a chance? https://x/1");
    expect(nudgeText([{ url: "https://x/1" }, { url: "https://x/2" }])).toBe("could you take a look at these when you get a chance?\nhttps://x/1\nhttps://x/2");
  });
});
