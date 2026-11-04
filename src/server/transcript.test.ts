import { describe, expect, test } from "bun:test";
import { dialogOf, entriesOf, toolLine } from "./transcript";

const line = (o: object) => JSON.stringify(o);
const user = (content: unknown, extra = {}) => line({ type: "user", uuid: "u", message: { role: "user", content }, ...extra });
const said = (t: string) => line({ type: "assistant", uuid: "a", message: { content: [{ type: "text", text: t }] } });
const tool = (name: string, input: object, id = "t1") => line({ type: "assistant", uuid: "b", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id = "t1", is_error = false) => user([{ type: "tool_result", tool_use_id: id, content: "x", is_error }]);

describe("entriesOf", () => {
  test("the user, the agent, and a run of tools as one entry", () => {
    const e = entriesOf([user("fix the cart"), said("Looking."), tool("Read", { file_path: "/r/src/cart.ts" }), result(), tool("Bash", { command: "bun test", description: "Run tests" }, "t2"), result("t2", true), said("Done.")].join("\n"));
    expect(e.map((x) => x.kind)).toEqual(["user", "agent", "tools", "agent"]);
    expect(e[2].tools).toEqual([{ id: "t1", line: "Read: src/cart.ts" }, { id: "t2", line: "Bash: Run tests", failed: true }]);
  });
  test("harness wrappers aren't the user; a slash command shows as typed", () => {
    const e = entriesOf([user("<system-reminder>x</system-reminder>"), user("hi", { isMeta: true }), user("<command-name>/clear</command-name><command-args></command-args>")].join("\n"));
    expect(e).toEqual([{ id: "u", kind: "user", text: "/clear", at: null }]);
  });
  test("a recap shows; a broken line is skipped", () => {
    const e = entriesOf([line({ type: "system", subtype: "away_summary", content: "Fixed it.", uuid: "r" }), "{nope"].join("\n"));
    expect(e).toEqual([{ id: "r", kind: "recap", text: "Fixed it.", at: null }]);
  });
});

describe("toolLine", () => {
  test("what each tool did, short", () => {
    expect(toolLine("Grep", { pattern: "foo", path: "/a/b/src" })).toBe("Grep: foo in b/src");
    expect(toolLine("Skill", { skill: "review-queue" })).toBe("Skill: /review-queue");
  });
});

describe("dialogOf", () => {
  test("a permission prompt: the question, the options, which is picked", () => {
    const screen = [
      "⏺ Pushing now.", "",
      "╭────────────────────────────────────╮",
      "│ Bash command                        │",
      "│                                     │",
      "│   git push origin main              │",
      "│   Push to remote                    │",
      "│                                     │",
      "│ Do you want to proceed?             │",
      "│ ❯ 1. Yes                            │",
      "│   2. Yes, and don't ask again       │",
      "│   3. No, and tell Claude what to do differently (esc) │",
      "╰────────────────────────────────────╯",
    ].join("\n");
    const d = dialogOf(screen)!;
    expect(d.question).toBe("Do you want to proceed?");
    expect(d.context).toContain("git push origin main");
    expect(d.options.map((o) => [o.n, o.label, o.current])).toEqual([[1, "Yes", true], [2, "Yes, and don't ask again", false], [3, "No, and tell Claude what to do differently (esc)", false]]);
  });
  test("a question with descriptions under its options", () => {
    const screen = ["Which approach?", "", "  1. Cache it", "     Keeps a copy for an hour", "❯ 2. Fetch fresh", "     Always current", "  3. Type something.", "", "Enter to select · ↑/↓ to navigate · Esc to cancel"].join("\n");
    const d = dialogOf(screen)!;
    expect(d.question).toBe("Which approach?");
    expect(d.options.map((o) => [o.label, o.detail, o.current])).toEqual([["Cache it", "Keeps a copy for an hour", false], ["Fetch fresh", "Always current", true], ["Type something.", null, false]]);
  });
  test("no dialog: a numbered list in prose far up, or none at all", () => {
    expect(dialogOf("Done.\n\n> ")).toBeNull();
    expect(dialogOf(["1. first", "2. second", ...Array(50).fill("text")].join("\n"))).toBeNull();
  });
});
