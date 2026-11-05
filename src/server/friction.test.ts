import { describe, expect, test } from "bun:test";
import { itemsOf } from "./friction";
import { deleteRoutine, routines, saveRoutine } from "./routines";
import type { Turn } from "./tokens";
import { sessionsOf } from "./usage";

const turn = (session: string, at: string, branch: string): Turn =>
  ({ id: `${session}${at}`, at, session, model: "m", dir: "/p/widgets", branch, input: 1, output: 1, read: 0, write5m: 0, write1h: 0 });
// Feature branches go by their key; a trunk by the repo's.
const keyOf = (t: Turn) => ({ key: t.branch === "main" ? "widgets:main" : t.branch.toUpperCase(), repo: "widgets" });

describe("sessionsOf", () => {
  test("a session goes by the item of its last turn, with its span and turn count", () => {
    const s = sessionsOf([turn("a", "1", "main"), turn("a", "2", "demo-1"), turn("a", "3", "demo-1")], keyOf, (x) => `/t/${x}.jsonl`);
    expect(s).toEqual([{ session: "a", item: "DEMO-1", repo: "widgets", from: "1", to: "3", turns: 3, transcript: "/t/a.jsonl" }]);
  });
  test("sessions that stay on a trunk or run outside a repo aren't tied to a work item", () => {
    const outside = (t: Turn) => ({ key: "outside a repo: tmp", repo: null });
    expect(sessionsOf([turn("a", "1", "main")], keyOf, () => null)).toEqual([]);
    expect(sessionsOf([turn("b", "1", "demo-2")], outside, () => null)).toEqual([]);
  });
});

describe("itemsOf", () => {
  test("groups sessions by item, busiest first, with the item's board moves matched by id", () => {
    const s = (session: string, item: string, turns: number) => ({ session, item, repo: "widgets", from: "1", to: "2", turns, transcript: null });
    const items = itemsOf([s("a", "DEMO-1", 2), s("b", "DEMO-2", 5), s("c", "DEMO-1", 1)],
      [{ at: "1", item: "demo-2", kind: "arrive", lane: "mine", step: null, detail: null }, { at: "1", item: "other", kind: "arrive", lane: "mine", step: null, detail: null }]);
    expect(items.map((i) => [i.item, i.sessions.length, i.board.length])).toEqual([["DEMO-2", 1, 1], ["DEMO-1", 2, 0]]);
    expect(items[0].repos).toEqual(["widgets"]);
  });
});

describe("default routines", () => {
  test("the friction review is there from the start, keeps its session index on save, and stays gone once deleted", () => {
    const f = routines().find((r) => r.id === "friction")!;
    expect(f.brief).toBe("sessions");
    expect(saveRoutine({ ...f, enabled: false }).brief).toBe("sessions");
    deleteRoutine("friction");
    expect(routines().some((r) => r.id === "friction")).toBe(false);
  });
});
