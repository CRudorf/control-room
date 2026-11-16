import { describe, expect, test } from "bun:test";
import { isDue, periodOf, runRepos } from "./routines";
import type { Routine } from "../shared/types";

const r = (o: Partial<Routine> = {}): Routine => ({ id: "errors", name: "Errors", prompt: "", repos: ["widgets"], cadence: "daily", weekday: 1, weekdaysOnly: true, when: "start", enabled: true, ...o });
// Local times: a Wednesday, a Saturday, a Monday.
const wed = (h: number, m = 0) => new Date(2030, 0, 2, h, m);
const sat = new Date(2030, 0, 5, 10), mon = new Date(2030, 0, 7, 10);

describe("isDue", () => {
  test("when the user starts work: the first time they're at the machine after 5am", () => {
    expect(isDue(r(), wed(9), undefined, true)).toBe(true);
    expect(isDue(r(), wed(9), undefined, false)).toBe(false);
    expect(isDue(r(), wed(4), undefined, true)).toBe(false);
  });
  test("at a set time, from that minute on", () => {
    expect(isDue(r({ when: "08:30" }), wed(8, 29), undefined, false)).toBe(false);
    expect(isDue(r({ when: "08:30" }), wed(8, 30), undefined, false)).toBe(true);
  });
  test("once a day; a failed start tries again half an hour later", () => {
    const at = wed(9).toISOString(), period = periodOf(r(), wed(9));
    expect(isDue(r(), wed(11), { period, at, trigger: "schedule", agents: [], error: null }, true)).toBe(false);
    expect(isDue(r(), wed(9, 20), { period, at, trigger: "schedule", agents: [], error: "x" }, true)).toBe(false);
    expect(isDue(r(), wed(9, 31), { period, at, trigger: "schedule", agents: [], error: "x" }, true)).toBe(true);
  });
  test("weekdays only skips the weekend; paused never runs", () => {
    expect(isDue(r(), sat, undefined, true)).toBe(false);
    expect(isDue(r({ weekdaysOnly: false }), sat, undefined, true)).toBe(true);
    expect(isDue(r({ enabled: false }), wed(9), undefined, true)).toBe(false);
  });
  test("weekly: on its weekday or the first weekday after, once a week", () => {
    const wk = r({ cadence: "weekly", weekday: 3 });
    expect(isDue(wk, mon, undefined, true)).toBe(false);
    expect(isDue(wk, wed(9), undefined, true)).toBe(true);
    expect(isDue(wk, new Date(2030, 0, 3, 9), { period: periodOf(wk, wed(9)), at: wed(9).toISOString(), trigger: "schedule", agents: [], error: null }, true)).toBe(false);
  });
});

describe("runRepos", () => {
  const here = (repo: string) => repo !== "control-room";
  test("a run starts only in the routine's repos of this project, and skips the rest", () => {
    expect(runRepos(r({ repos: ["widgets", "control-room"] }), here, ["gadgets", "widgets"])).toEqual({ repos: ["widgets"], skipped: ["control-room"] });
    expect(runRepos(r({ repos: ["widgets"] }), here, ["widgets"])).toEqual({ repos: ["widgets"], skipped: [] });
  });
  test("a routine with no repo in this project starts nowhere", () => {
    expect(runRepos(r({ repos: ["control-room"] }), here, ["widgets"])).toEqual({ repos: [], skipped: ["control-room"] });
  });
  test("the friction review reads this Mac's sessions, so it runs in the project's first repo instead", () => {
    const friction = r({ id: "friction", repos: ["control-room"], brief: "sessions" });
    expect(runRepos(friction, here, ["gadgets", "widgets"])).toEqual({ repos: ["gadgets"], skipped: ["control-room"] });
    expect(runRepos(friction, () => true, ["gadgets"])).toEqual({ repos: ["control-room"], skipped: [] });
    expect(runRepos(friction, here, [])).toEqual({ repos: [], skipped: ["control-room"] });
  });
});
