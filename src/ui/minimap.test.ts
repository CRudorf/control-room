import { describe, expect, test } from "bun:test";
import { minimapDots } from "./minimap";

const item = (id: string, lane: string, urgency: number) => ({ id, key: id.toUpperCase(), title: `t ${id}`, why: `why ${id}`, lane, urgency }) as never;
const dist = (d: { x: number; y: number }) => Math.hypot(d.x - 50, d.y - 50);

describe("minimapDots", () => {
  test("only items on the user's turn or asked of them", () => {
    const dots = minimapDots([item("a", "mine", 2), item("b", "asked", 1), item("c", "waiting", 3), item("d", "parked", 0)]);
    expect(dots.map((d) => [d.id, d.lane])).toEqual([["a", "mine"], ["b", "asked"]]);
  });
  test("the more pressing, the nearer the middle", () => {
    const ids = ["x1", "x2", "x3", "x4", "x5", "x6"];
    const at = (u: number) => minimapDots(ids.map((i) => item(i, "mine", u))).map(dist);
    expect(Math.max(...at(3))).toBeLessThan(Math.min(...at(2)));
    expect(Math.max(...at(2))).toBeLessThan(Math.min(...at(1)));
    expect(Math.max(...at(1))).toBeLessThanOrEqual(Math.min(...at(0)));
    expect(Math.max(...at(0))).toBeLessThan(50);
  });
  test("an item stays put between snapshots", () => {
    expect(minimapDots([item("a", "mine", 2)])).toEqual(minimapDots([item("b", "asked", 1), item("a", "mine", 2)]).slice(1));
  });
});
