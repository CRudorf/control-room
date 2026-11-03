import { describe, expect, test } from "bun:test";
import { lastSkill, resolveTask, taskForStart, taskOfLabel, taskOfSkill } from "./tasks";

describe("taskForStart", () => {
  test("from what the control room asked for", () => {
    expect(taskForStart({ kind: "custom", item: "abc-1" })).toBe("build");
    expect(taskForStart({ kind: "feedback", item: "abc-1" })).toBe("fix");
    expect(taskForStart({ kind: "conflicts", item: "abc-1" })).toBe("fix");
    expect(taskForStart({ kind: "selfreview", item: "abc-1" })).toBe("selfreview");
    expect(taskForStart({ kind: "review", item: "abc-1" })).toBe("review");
    expect(taskForStart({ kind: "custom", verb: "chart", item: "abc-1" })).toBe("chart");
    expect(taskForStart({ kind: "custom", verb: "verify", item: "abc-1" })).toBe("verify");
    expect(taskForStart({ kind: "custom", item: "verify-cart" })).toBe("verify");
  });
  test("the self-improvement loop, lessons, architecture and Stop checks are improving", () => {
    for (const item of ["loop-2030-W01", "lesson-cart", "arch-widgets", "stop-check-widgets"]) expect(taskForStart({ kind: "custom", item })).toBe("improve");
  });
});

describe("skills", () => {
  test("the last skill a transcript ran, typed or called", () => {
    const t = [
      `{"type":"user","message":{"content":"<command-name>/mattpocock-skills:grilling</command-name>"}}`,
      `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"mattpocock-skills:improve-codebase-architecture"}}]}}`,
    ].join("\n");
    expect(lastSkill(t)).toBe("mattpocock-skills:improve-codebase-architecture");
    expect(lastSkill(t.split("\n")[0])).toBe("mattpocock-skills:grilling");
    expect(lastSkill("nothing here")).toBeNull();
  });
  test("map to tasks; skills that say nothing about the task don't", () => {
    expect(taskOfSkill("mattpocock-skills:grilling")).toBe("grill");
    expect(taskOfSkill("mattpocock-skills:grill-with-docs")).toBe("grill");
    expect(taskOfSkill("mattpocock-skills:improve-codebase-architecture")).toBe("improve");
    expect(taskOfSkill("verify-change")).toBe("verify");
    expect(taskOfSkill("update-config")).toBeNull();
  });
});

describe("resolveTask", () => {
  test("a helper keeps what it was started for, whatever skill it runs", () => {
    expect(resolveTask("selfreview", "review", "x")).toEqual({ task: "selfreview", taskFrom: "start" });
  });
  test("a builder takes on the skill it's running, else keeps its start, else the label's guess", () => {
    expect(resolveTask("build", "grill", "x")).toEqual({ task: "grill", taskFrom: "skill" });
    expect(resolveTask("fix", null, "x")).toEqual({ task: "fix", taskFrom: "start" });
    expect(resolveTask(null, null, "chart widgets#7")).toEqual({ task: "chart", taskFrom: "label" });
  });
  test("labels: the verb, or the item an improvement agent is named for", () => {
    expect(taskOfLabel("agent loop-2030-W01")).toBe("improve");
    expect(taskOfLabel("selfreview widgets#7")).toBe("selfreview");
    expect(taskOfLabel("ABC-1 fix")).toBe("build");
  });
});
