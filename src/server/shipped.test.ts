import { describe, expect, test } from "bun:test";
import type { Shipped } from "../shared/types";
import { diffLines, effective, errorLines, logicLine, newlyFailed, stackName, suspectOf, verdictOf, watchedFiles } from "./shipped";

const run = (name: string, conclusion: string | null, status = "completed") => ({ name, status, conclusion });
const NOW = Date.parse("2030-01-10T00:00:00Z");
const w = (over: Partial<Shipped> = {}) => ({ ciFailures: [], reverts: [], rework: [], sentry: [], until: "2030-01-12T00:00:00Z", ...over });
const h = (over = {}) => ({ sha: "a", at: "2030-01-09T00:00:00Z", text: "refactor x", url: "u", ...over });
const fail = (over = {}) => ({ name: "deploy", url: "u", errors: [], next: null, suspect: null, ...over });

describe("shipped", () => {
  test("only checks the merge broke count: one already red before it doesn't", () => {
    expect(newlyFailed([run("zap", "failure"), run("test", "success")], [run("zap", "failure"), run("test", "success")])).toEqual([]);
    expect(newlyFailed([run("deploy prod", "failure")], [run("deploy prod", "success")]).map((r) => r.name)).toEqual(["deploy prod"]);
  });
  test("a revert or a fix commit rewriting the PR's lines is broke; a plain rewrite is changed", () => {
    expect(verdictOf(w({ reverts: [h()] }), NOW)).toBe("broke");
    expect(verdictOf(w({ rework: [h({ fix: true })] }), NOW)).toBe("broke");
    expect(verdictOf(w({ rework: [h({ fix: false })] }), NOW)).toBe("changed");
    expect(verdictOf(w(), NOW)).toBe("watching");
    expect(verdictOf(w({ sentry: null }), Date.parse("2030-01-13T00:00:00Z"))).toBe("clean");
  });
  test("CI after the merge asks for a look unless it looks like infra or passed again", () => {
    expect(verdictOf(w({ ciFailures: [fail()] }), NOW)).toBe("look");
    expect(verdictOf(w({ ciFailures: [fail({ suspect: "infra" })] }), NOW)).toBe("watching");
    expect(suspectOf({ errors: ["Failed to launch AWX job. HTTP 502"], next: null })).toContain("infrastructure");
    expect(suspectOf({ errors: [`error Couldn't find any versions for "@rollup/rollup-darwin-x64"`], next: null })).toContain("infrastructure");
    expect(suspectOf({ errors: ["AssertionError: 3 != 4"], next: "passed" })).toContain("passed again");
    expect(suspectOf({ errors: ["AssertionError: 3 != 4"], next: "failed" })).toBeNull();
  });
  test("Pat's verdict wins over the watch", () => {
    const s = { ...w({ reverts: [h()] }), state: "broke" } as Shipped;
    expect(effective({ ...s, verdict: { verdict: "not", why: "", by: "you", at: "" } }, NOW)).toBe("watching");
    expect(effective({ ...s, state: "look", verdict: { verdict: "caused", why: "", by: "you", at: "" } }, NOW)).toBe("broke");
  });
  test("logic lines leave out blanks, brackets, comments and imports; diffs compare by them", () => {
    expect(logicLine("    }")).toBeNull();
    expect(logicLine("import os")).toBeNull();
    expect(logicLine("  # a comment here")).toBeNull();
    expect(logicLine("    if  total > limit:  ")).toBe("if total > limit:");
    expect(logicLine("return ResponseEntity")).toBeNull();
    expect(logicLine("ErrorResponse(")).toBeNull();
    const patch = "@@ -1,3 +1,3 @@\n-    if total > limit:\n+    if total >= limit:\n     return None\n+}";
    expect([...diffLines(patch, "+")]).toEqual(["if total >= limit:"]);
    expect([...diffLines(patch, "-")]).toEqual(["if total > limit:"]);
  });
  test("a job log comes down to its error lines", () => {
    const log = "2030-01-01T00:00:00.1Z Run deploy\n2030-01-01T00:00:01.1Z \x1b[31mError: boom happened\x1b[0m\n2030-01-01T00:00:02.1Z ##[error]Failed to launch AWX job. HTTP 502\n2030-01-01T00:00:02.2Z ##[error]Process completed with exit code 1.";
    expect(errorLines(log)).toEqual(["Error: boom happened", "Failed to launch AWX job. HTTP 502"]);
    expect(errorLines(`2030-01-01T00:00:00.1Z   echo "::error::AWX launch response missing job id"\n2030-01-01T00:00:02.1Z ##[error]boom`)).toEqual(["boom"]);
  });
  test("watches code, not tests, docs or lockfiles", () => {
    expect(watchedFiles(["core/a.py", "core/tests/test_a.py", "src/b.test.ts", "README.md", "uv.lock", "web/x.tsx", "test_c.py"])).toEqual(["core/a.py", "web/x.tsx"]);
  });
  test("a generic file name keeps its folder for the stack search", () => {
    expect(stackName("core/payor/service_election.py")).toBe("service_election.py");
    expect(stackName("core/payor/views.py")).toBe("payor/views.py");
  });
});
