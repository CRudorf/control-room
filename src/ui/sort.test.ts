import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../shared/types";
import { nextSort, sortBy } from "./sort";

const none = { text: "·", tone: "dim" } as const;
const item = (key: string, over: object = {}) => ({ id: key, key, prs: [], agents: [], cells: { fb: none, ci: none, rv: none, mg: none, ag: none }, ...over }) as unknown as WorkItem;

describe("board sort", () => {
  test("a cell column puts red first, empty last; equal ones keep the board's order", () => {
    const xs = [
      item("a", { cells: { ...item("a").cells, ci: { text: "✓", tone: "ok" } } }),
      item("b"),
      item("c", { cells: { ...item("c").cells, ci: { text: "✗", tone: "pen" } } }),
      item("d"),
    ];
    expect(sortBy(xs, { col: "ci", dir: 1 }).map((x) => x.key)).toEqual(["c", "a", "b", "d"]);
    expect(sortBy(xs, { col: "ci", dir: -1 }).map((x) => x.key)).toEqual(["b", "d", "a", "c"]);
    expect(sortBy(xs, null)).toBe(xs);
  });
  test("last puts a working agent, then the newest action, first; nothing last", () => {
    const xs = [
      item("old", { last: { at: "2030-01-01T00:00:00Z", what: "push" } }),
      item("none"),
      item("now", { last: { at: "2029-01-01T00:00:00Z", what: "agent is working", now: true } }),
      item("new", { last: { at: "2030-01-05T00:00:00Z", what: "push" } }),
    ];
    expect(sortBy(xs, { col: "last", dir: 1 }).map((x) => x.key)).toEqual(["now", "new", "old", "none"]);
  });
  test("feedback: most first", () => {
    const fb = (n: number) => ({ prs: [{ feedback: Array(n).fill({}) }] });
    expect(sortBy([item("one", fb(1)), item("three", fb(3)), item("zero", fb(0))], { col: "fb", dir: 1 }).map((x) => x.key)).toEqual(["three", "one", "zero"]);
  });
  test("a click sorts ascending, then descending, then off; another column starts over", () => {
    expect(nextSort(null, "ci")).toEqual({ col: "ci", dir: 1 });
    expect(nextSort({ col: "ci", dir: 1 }, "ci")).toEqual({ col: "ci", dir: -1 });
    expect(nextSort({ col: "ci", dir: -1 }, "ci")).toBeNull();
    expect(nextSort({ col: "ci", dir: -1 }, "last")).toEqual({ col: "last", dir: 1 });
  });
});
