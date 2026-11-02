import { describe, expect, test } from "bun:test";
import type { Shipped } from "../shared/types";
import type { Lesson } from "./lessons";
import { breakFiles, caught, lessonsBefore, replayPrompt } from "./replay";

const hit = (over = {}) => ({ sha: "s", at: "2030-01-09T00:00:00Z", text: "fix the total", url: "u", ...over });
const w = (over: Partial<Shipped> = {}): Shipped => ({
  ref: "acme/widgets#7", repo: "acme/widgets", url: "https://example.test/pr/7", title: "Total the cart", feature: "ABC-7", merged: "2030-01-08T00:00:00Z",
  until: "2030-01-15T00:00:00Z", mergeSha: "abc123", state: "broke", ci: "success", ciFailures: [], reverts: [], rework: [], sentry: [], files: ["src/cart.ts", "src/total.ts"], checkedAt: "", ...over,
});
const l = (ref: string, at: string): Lesson => ({ repo: "acme/widgets", ref, text: `lesson ${ref}`, at });

describe("replay", () => {
  test("the break's files: fix commits first, the whole PR when reverted", () => {
    expect(breakFiles(w({ rework: [hit({ file: "src/total.ts", fix: true }), hit({ file: "src/cart.ts", fix: false })] }))).toEqual(["src/total.ts"]);
    expect(breakFiles(w({ reverts: [hit()] }))).toEqual(["src/cart.ts", "src/total.ts"]);
    expect(breakFiles(w({ rework: [hit({ file: "src/cart.ts" })] }))).toEqual(["src/cart.ts"]);
  });
  test("a finding in a file the break was in is a catch", () => {
    expect(caught([{ path: "src/total.ts" }], ["src/total.ts"])).toBe(true);
    expect(caught([{ path: "total.ts" }], ["src/total.ts"])).toBe(true);
    expect(caught([{ path: "src/cart.ts" }, {}], ["src/total.ts"])).toBe(false);
    expect(caught([], ["src/total.ts"])).toBe(false);
  });
  test("replays with the lessons from before the merge, its own left out", () => {
    const all = [l("acme/widgets#1", "2029-12-01T00:00:00Z"), l("acme/widgets#7", "2030-01-10T00:00:00Z"), l("acme/widgets#9", "2030-01-20T00:00:00Z"), l("acme/widgets#2", "2029-01-01T00:00:00Z")];
    expect(lessonsBefore(all, w()).map((x) => x.ref)).toEqual(["acme/widgets#1"]);
  });
  test("the prompt reviews the PR as merged, writes the replay file, and changes nothing", () => {
    const p = replayPrompt(w(), [l("acme/widgets#1", "2029-12-01T00:00:00Z")]);
    expect(p).toContain("git fetch origin pull/7/head");
    expect(p).toContain("git diff abc123^1...HEAD");
    expect(p).toContain("lesson acme/widgets#1");
    expect(p).toContain("replays/acme__widgets__7.json");
    expect(p).toContain("Make no code changes");
  });
});
