import { describe, expect, test } from "bun:test";
import { isDue, periodOf } from "./routines";
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
