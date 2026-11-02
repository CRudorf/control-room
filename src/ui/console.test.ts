import { describe, expect, test } from "bun:test";
import { merge, opOf } from "./console";

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  opOf({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("typing into a session", () => {
  test("characters are text; editing and dialog keys are keys", () => {
    expect(k("a")).toEqual([{ text: "a" }]);
    expect(k(" ")).toEqual([{ text: " " }]);
    expect(k("Enter")).toEqual([{ key: "enter" }]);
    expect(k("Backspace")).toEqual([{ key: "backspace" }]);
    expect(k("Escape")).toEqual([{ key: "esc" }]);
    expect(k("ArrowUp")).toEqual([{ key: "up" }]);
    expect(k("Tab", { shiftKey: true })).toEqual([{ key: "shift+tab" }]);
    expect(k("c", { ctrlKey: true })).toEqual([{ key: "ctrl+c" }]);
  });
  test("⇧⏎ is Claude's new line; ⌘ keys and the rest stay with the browser", () => {
    expect(k("Enter", { shiftKey: true })).toEqual([{ text: "\\" }, { key: "enter" }]);
    expect(k("v", { metaKey: true })).toBeNull();
    expect(k("Shift")).toBeNull();
    expect(k("F5")).toBeNull();
  });
  test("a burst of typing is one write, in order around the keys", () => {
    expect(merge([{ text: "h" }, { text: "i" }, { key: "enter" }, { text: "x" }])).toEqual([{ text: "hi" }, { key: "enter" }, { text: "x" }]);
  });
});
