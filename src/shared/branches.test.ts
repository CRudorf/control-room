import { expect, test } from "bun:test";
import { workLines } from "./branches";

test("a branch and its -stage copy are one line; scratch and base branches are not work", () => {
  expect(workLines(["ABC-1", "ABC-1-stage", "worktree-cr-x", "master", "staging", "HEAD", null], { stages: ["staging", "master"], copySuffix: "-stage" })).toEqual(["ABC-1"]);
  expect(workLines(["ABC-6787", "ABC-6787-stage", "ABC-6787-stage-fix"], { copySuffix: "-stage" })).toEqual(["ABC-6787", "ABC-6787-stage-fix"]);
});

test("with no flow, a -stage branch is its own line of work", () => {
  expect(workLines(["fix-a", "fix-a-stage"])).toEqual(["fix-a", "fix-a-stage"]);
});
