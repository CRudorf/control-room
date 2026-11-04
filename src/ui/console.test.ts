import { describe, expect, test } from "bun:test";
import { keysFor } from "./console";

const d = (current: number) => ({ options: [1, 2, 3].map((n) => ({ n, label: `o${n}`, detail: null, current: n === current })) });

describe("keysFor", () => {
  test("moves from the picked option to the chosen one, then enter", () => {
    expect(keysFor(d(1), 3)).toEqual(["down", "down", "enter"]);
    expect(keysFor(d(3), 1)).toEqual(["up", "up", "enter"]);
    expect(keysFor(d(2), 2)).toEqual(["enter"]);
  });
  test("an option that isn't there sends nothing", () => {
    expect(keysFor(d(1), 7)).toEqual([]);
  });
});
