import { describe, expect, test } from "bun:test";
import { otherLoopDirs, prompt, waitsForBriefs } from "./loop";

const support = "/state";

describe("otherLoopDirs", () => {
  test("every other project's loop folder, not this project's", () => {
    expect(otherLoopDirs({ a: { stateDir: "cr-a" }, b: { stateDir: "cr-b" } }, `${support}/cr-a`)).toEqual([`${support}/cr-b/loop`]);
  });
  test("a project with no state folder of its own uses the default one", () => {
    expect(otherLoopDirs({ a: {}, b: { stateDir: "cr-b" } }, `${support}/cr-b`)).toEqual([`${support}/control-room/loop`]);
    expect(otherLoopDirs({ a: {}, b: { stateDir: "cr-b" } }, `${support}/control-room`)).toEqual([`${support}/cr-b/loop`]);
  });
  test("two projects on one state folder count once", () => {
    expect(otherLoopDirs({ a: { stateDir: "cr-a" }, b: { stateDir: "cr-a" }, c: { stateDir: "cr-c" } }, `${support}/cr-c`)).toEqual([`${support}/cr-a/loop`]);
  });
  test("no other project: nothing", () => {
    expect(otherLoopDirs({}, `${support}/cr-a`)).toEqual([]);
    expect(otherLoopDirs({ a: { stateDir: "cr-a" } }, `${support}/cr-a`)).toEqual([]);
  });
});

describe("waitsForBriefs", () => {
  test("waits for a missing brief until the last hour of the window", () => {
    expect(waitsForBriefs(1, 9, 12)).toBe(true);
    expect(waitsForBriefs(1, 10, 12)).toBe(true);
    expect(waitsForBriefs(1, 11, 12)).toBe(false);
  });
  test("no missing brief: no wait", () => {
    expect(waitsForBriefs(0, 9, 12)).toBe(false);
  });
});

describe("prompt", () => {
  test("names the other projects' briefs, and says which are missing", () => {
    const text = prompt("2030-01-07", "/s/a/brief.json", "/s/a/report.md", { found: ["/s/b/brief.json"], missing: ["/s/c/brief.json"] });
    expect(text).toContain(`"/s/b/brief.json"`);
    expect(text).toContain("keep each project's numbers apart");
    expect(text).toContain(`no brief from: "/s/c/brief.json"`);
    expect(text).toContain("missing, not zero");
  });
  test("with one project it says nothing about others", () => {
    const text = prompt("2030-01-07", "/s/a/brief.json", "/s/a/report.md");
    expect(text).not.toContain("other projects");
    expect(text).not.toContain("no brief from");
  });
});
