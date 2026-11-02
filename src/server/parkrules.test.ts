import { describe, expect, test } from "bun:test";
import type { Issue, ItemBranch } from "../shared/types";
import { parkState, type ParkRule } from "./parkrules";
import { applyJira } from "./workitems";
import { dayLabel, duration, groupByDay } from "../ui/finishedview";

const issue = (over: Partial<Issue> = {}): Issue => ({ key: "ABC-1", summary: "a thing", status: "Ready", category: "indeterminate", mine: true, updated: "2026-10-28T00:00:00Z", url: "https://x/ABC-1", transitions: [], ...over });
const branch = (onLast: boolean): ItemBranch => ({ repo: "acme/widgets", name: "ABC-1", lastCommitAt: "2026-10-28T00:00:00Z", stages: [{ name: "test", in: true }, { name: "prod", in: onLast }] });
const rule: ParkRule = { status: "Ready", note: "Waiting to deploy", finishWhen: ["last-stage", "done", "status:Shipped"], wakeAfterDays: 3 };
const NOW = Date.parse("2026-10-30T00:00:00Z");
const state = (i: Issue, bs: ItemBranch[] = [], prior?: { status: string; at: string }, released = false) => parkState(i, bs, [rule], prior, released, NOW);

describe("park rules", () => {
  test("no rule changes nothing", () => expect(parkState(issue(), [], [], undefined, false).state).toBe("none"));
  test("reaching the status parks the issue", () => expect(state(issue())).toMatchObject({ state: "parked", note: "Waiting to deploy" }));
  test("the last stage finishes it", () => expect(state(issue(), [branch(true)])).toMatchObject({ state: "finished", why: "reached prod" }));
  test("a branch short of the last stage stays parked", () => expect(state(issue(), [branch(false)]).state).toBe("parked"));
  test("a move to a done status finishes it", () =>
    expect(state(issue({ status: "Closed", category: "done" }), [], { status: "Ready", at: "2026-10-29T00:00:00Z" })).toMatchObject({ state: "finished", why: "moved to Closed" }));
  test("a named status finishes it", () =>
    expect(state(issue({ status: "Shipped" }), [], { status: "Ready", at: "2026-10-29T00:00:00Z" }).state).toBe("finished"));
  test("a move back to work leaves Parked", () =>
    expect(state(issue({ status: "In Progress" }), [], { status: "Ready", at: "2026-10-29T00:00:00Z" }).state).toBe("none"));
  test("an issue never parked ignores the finish conditions of other statuses", () => expect(state(issue({ status: "Closed", category: "done" })).state).toBe("none"));
  test("too long parked wakes it", () => expect(state(issue(), [], { status: "Ready", at: "2026-10-26T00:00:00Z" }).state).toBe("woke"));
  test("the first park date holds across reads", () => expect(state(issue(), [], { status: "Ready", at: "2026-10-29T00:00:00Z" })).toMatchObject({ since: "2026-10-29T00:00:00Z" }));
  test("unparking by hand holds, but a finish still counts", () => {
    expect(state(issue(), [], undefined, true).state).toBe("none");
    expect(state(issue(), [branch(true)], undefined, true).state).toBe("finished");
  });
});

describe("the board with park rules", () => {
  const board = (i: Issue, bs: ItemBranch[], prs: any[] = []) => applyJira(prs, new Map([[i.key, i]]), { branchesFor: () => bs, parkOf: (j, b) => parkState(j, b, [rule], undefined, false, NOW) });
  test("a parked issue sits in Parked with its note", () => expect(board(issue(), [branch(false)])[0]).toMatchObject({ lane: "parked", why: "“Waiting to deploy”" }));
  test("a finished issue leaves the board", () => expect(board(issue(), [branch(true)])).toEqual([]));
});

describe("Finished page helpers", () => {
  const f = (at: string) => ({ key: at, title: "", repos: [], at, prs: [] });
  test("days run newest first", () => expect(groupByDay([f("2026-10-01T12:00:00"), f("2026-10-03T12:00:00"), f("2026-10-03T13:00:00")]).map(([, r]) => r.length)).toEqual([2, 1]));
  test("recent days get names", () => {
    const now = new Date(2026, 9, 30, 12);
    expect(dayLabel("2026-10-30", now)).toBe("Today");
    expect(dayLabel("2026-10-29", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-26", now)).toBe("Mon, Oct 26");
  });
  test("durations", () => {
    expect(duration("2026-10-01T00:00:00Z", "2026-10-01T03:00:00Z")).toBe("3h");
    expect(duration("2026-10-01T00:00:00Z", "2026-10-06T00:00:00Z")).toBe("5d");
    expect(duration(undefined, "2026-10-06T00:00:00Z")).toBeNull();
  });
});
