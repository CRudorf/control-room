import { describe, expect, test } from "bun:test";
import { runningKinds } from "./running";

const item = (over: object = {}) => ({ prs: [], agents: [], ...over }) as unknown as Parameters<typeof runningKinds>[0];

describe("runningKinds", () => {
  test("nothing running", () => {
    expect(runningKinds(item({ prs: [{ checks: "success" }], agents: [{ status: "idle" }], loop: [{ state: "watching" }], stopChecks: [{ running: false }] }))).toEqual([]);
  });
  test("each kind, in a fixed order", () => {
    expect(runningKinds(item({ prs: [{ checks: "success" }, { checks: "pending" }], agents: [{ status: "working" }], loop: [{ state: "running" }], stopChecks: [{ running: true }] })))
      .toEqual(["ci", "agent", "loop", "tests"]);
    expect(runningKinds(item({ stopChecks: [{ running: true }] }))).toEqual(["tests"]);
  });
});
