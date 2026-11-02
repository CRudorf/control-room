import { describe, expect, test } from "bun:test";
import { current, dueStick, goneLessons, SHELF_MS, stickPrompt, withLesson, type Lesson } from "./lessons";
import { lessonFiles } from "./shipped";

const NOW = Date.parse("2030-06-01T00:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const l = (over: Partial<Lesson> = {}): Lesson => ({ repo: "acme/widgets", ref: "acme/widgets#1", text: "check the null case", at: ago(1), ...over });

describe("lessons", () => {
  test("a lesson past its shelf life drops out; one seen again since stays", () => {
    const all = [l({ ref: "a#1", at: ago(91) }), l({ ref: "a#2", at: ago(91), seen: ago(3) }), l({ ref: "a#3", at: ago(89) })];
    expect(current(all, "acme/widgets", 8, NOW).map((x) => x.ref)).toEqual(["a#2", "a#3"]);
    expect(SHELF_MS).toBe(90 * 86_400_000);
  });
  test("matches the repo by name and keeps the newest n", () => {
    const all = [l({ ref: "a#1" }), l({ ref: "b#1", repo: "acme/gadgets" }), l({ ref: "a#2" }), l({ ref: "a#3" })];
    expect(current(all, "widgets", 2, NOW).map((x) => x.ref)).toEqual(["a#2", "a#3"]);
  });
  test("a new break through a lesson's files refreshes it, only in the same repo", () => {
    const all = [l({ ref: "a#1", at: ago(80), files: ["src/pay.ts"] }), l({ ref: "b#1", repo: "acme/gadgets", at: ago(80), files: ["src/pay.ts"] }), l({ ref: "a#2", at: ago(80), files: ["src/other.ts"] })];
    const next = withLesson(all, l({ ref: "a#9", at: ago(0), files: ["src/pay.ts"] }));
    expect(next.find((x) => x.ref === "a#1")?.seen).toBe(ago(0));
    expect(next.find((x) => x.ref === "b#1")?.seen).toBeUndefined();
    expect(next.find((x) => x.ref === "a#2")?.seen).toBeUndefined();
    expect(next.at(-1)?.ref).toBe("a#9");
  });
  test("re-adding a lesson for the same PR replaces it", () => {
    expect(withLesson([l({ ref: "a#1", text: "old" })], l({ ref: "a#1", text: "new" })).map((x) => x.text)).toEqual(["new"]);
  });
  test("cites the files rework hit, else the PR's own", () => {
    const hit = (file?: string) => ({ sha: "s", at: ago(1), text: "fix", url: "u", ...(file ? { file } : {}) });
    expect(lessonFiles({ rework: [hit("src/a.ts"), hit("src/a.ts"), hit("src/b.ts"), hit()], files: ["src/z.ts"] })).toEqual(["src/a.ts", "src/b.ts"]);
    expect(lessonFiles({ rework: [], files: ["src/z.ts"] })).toEqual(["src/z.ts"]);
  });
  test("the stick prompt names the lesson, its files and the PR, and never merges", () => {
    const p = stickPrompt(l({ files: ["src/pay.ts"] }), "https://example.test/pr/1");
    expect(p).toContain('"check the null case", in src/pay.ts');
    expect(p).toContain("https://example.test/pr/1");
    expect(p).toContain("`lesson/<short-slug>`");
    expect(p).toContain("Never merge");
  });
});

describe("lesson upkeep", () => {
  const l = (ref: string, over = {}) => ({ repo: "a/x", ref, text: ref, at: new Date().toISOString(), ...over });
  test("the next to stick is the newest current one with no agent and a watched PR", () => {
    const all = [l("a/x#1"), l("a/x#2"), l("a/x#3", { stick: { agent: "z", at: "" } }), l("a/x#4")];
    expect(dueStick(all, [{ ref: "a/x#1" }, { ref: "a/x#2" }, { ref: "a/x#3" }])?.lesson.ref).toBe("a/x#2");
    expect(dueStick([l("a/x#1", { at: "2000-01-01T00:00:00Z" })], [{ ref: "a/x#1" }])).toBeNull();
  });
  test("a lesson goes only when every cited file is known to be gone", () => {
    const all = [l("a/x#1", { files: ["gone"] }), l("a/x#2", { files: ["gone", "here"] }), l("a/x#3", { files: ["unknown"] }), l("a/x#4")];
    const exists = (_: string, f: string) => f === "here" ? true : f === "gone" ? false : null;
    expect(goneLessons(all, exists).map((x) => x.ref)).toEqual(["a/x#1"]);
  });
});
