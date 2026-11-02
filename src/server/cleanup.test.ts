import { expect, test } from "bun:test";
import { classify, IDLE_MS, parseWorktrees } from "./cleanup";

const now = 1e12, old = now - IDLE_MS - 1;
test("a worktree is safe only when nothing can be lost", () => {
  expect(classify({ dirty: 0, unpushed: 0, inUse: false, lastMs: old }, now).safe).toBe(true);
  expect(classify({ dirty: 1, unpushed: 0, inUse: false, lastMs: old }, now)).toEqual({ safe: false, why: "1 uncommitted file" });
  expect(classify({ dirty: 0, unpushed: 2, inUse: false, lastMs: old }, now)).toEqual({ safe: false, why: "2 commits not on a remote" });
  expect(classify({ dirty: 0, unpushed: 0, inUse: true, lastMs: old }, now).safe).toBe(false);
  expect(classify({ dirty: 0, unpushed: 0, inUse: false, lastMs: now - 1000 }, now).safe).toBe(false);
});
test("only worktrees under .claude/worktrees are listed, with their branches", () => {
  const out = "worktree /p/r\nHEAD a\nbranch refs/heads/main\n\nworktree /p/r/.claude/worktrees/x\nHEAD b\nbranch refs/heads/worktree-x\nlocked\n\nworktree /p/r/.claude/worktrees/y\nHEAD c\ndetached\n\nworktree /other/z\nHEAD d\ndetached\n";
  expect(parseWorktrees(out, "/p/r")).toEqual([{ path: "/p/r/.claude/worktrees/x", branch: "worktree-x" }, { path: "/p/r/.claude/worktrees/y", branch: null }]);
});
