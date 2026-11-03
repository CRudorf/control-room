import { describe, expect, test } from "bun:test";
import type { Agent, FinishedItem, PrRow, Snapshot, WorkItem } from "../../shared/types";
import { gains, LEVEL_XP, levelOf } from "./xp";

const pr = (over: Partial<PrRow> = {}) => ({ repo: "acme/widgets", number: 7, role: "mine", checks: "pending", review_decision: null, feedback: [], ...over }) as PrRow;
const snap = (prs: PrRow[], agents: Partial<Agent>[] = [], finished: Partial<FinishedItem>[] = []) =>
  ({ items: [{ id: "a", key: "ABC-1", prs, agents } as unknown as WorkItem], finished }) as unknown as Snapshot;

describe("levels", () => {
  test("follow the game's curve", () => {
    expect([LEVEL_XP[2], LEVEL_XP[10], LEVEL_XP[50], LEVEL_XP[99]]).toEqual([83, 1154, 101333, 13034431]);
    expect([levelOf(0), levelOf(82), levelOf(83), levelOf(13034431), levelOf(2e8)]).toEqual([1, 1, 2, 99, 99]);
  });
});

describe("gains", () => {
  test("CI passing, an approval and answered threads on the user's PRs", () => {
    const g = gains(snap([pr({ feedback: [{}, {}, {}] as PrRow["feedback"] })]), snap([pr({ checks: "success", review_decision: "APPROVED", feedback: [{}] as PrRow["feedback"] })]));
    expect(g).toEqual([
      { skill: "Testing", xp: 25, why: "CI passed on widgets#7" },
      { skill: "Reviewing", xp: 40, why: "widgets#7 approved" },
      { skill: "Reviewing", xp: 20, why: "answered 2 threads on widgets#7" },
    ]);
  });
  test("nothing for PRs that only appeared, or aren't the user's", () => {
    expect(gains(snap([]), snap([pr({ checks: "success" })]))).toEqual([]);
    expect(gains(snap([pr({ role: "requested" } as Partial<PrRow>)]), snap([pr({ role: "requested", checks: "success" } as Partial<PrRow>)]))).toEqual([]);
  });
  test("an agent finishing: building, or charting for a chart agent", () => {
    const g = gains(snap([], [{ pane: "p1", label: "fix", status: "working" }, { pane: "p2", label: "chart x", status: "working" }]),
      snap([], [{ pane: "p1", label: "fix", status: "done" }, { pane: "p2", label: "chart x", status: "done" }]));
    expect(g.map((x) => [x.skill, x.xp])).toEqual([["Building", 30], ["Charting", 30]]);
  });
  test("shipping: a newly finished item, a hundred per merged PR", () => {
    const g = gains(snap([]), snap([], [], [{ key: "ABC-2", prs: [{ state: "merged" }, { state: "merged" }, { state: "closed" }] as FinishedItem["prs"] }]));
    expect(g).toEqual([{ skill: "Shipping", xp: 200, why: "shipped ABC-2", shipped: true }]);
  });
});
