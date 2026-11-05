import { expect, test } from "bun:test";
import type { Agent, PrRow, WorkItem } from "../shared/types";
import { planStart } from "./handoff";
import { sessionContext } from "./itemview";
import { ownerOf } from "./tellagents";

const agent = (o: Partial<Agent>): Agent => ({ pane: "p", tab: "t", workspace: "w", name: null, label: "agent", title: "", workspaceLabel: "", status: "idle", cwd: "", repo: null, branch: null, session: null, focused: false, seq: 0, finishedSeq: null, ...o });
const p = { branch: "chore/stop-check" } as PrRow;

test("findings for a PR never go to the item's only session when it's building another branch", () => {
  expect(ownerOf(p, [agent({ branch: "fix/flaky-signup" })])).toBeNull();
  expect(ownerOf(p, [agent({ branch: "worktree-cr-x" })])?.pane).toBe("p");
  expect(ownerOf(p, [agent({ branch: "chore/stop-check", pane: "own" }), agent({ branch: "fix/flaky-signup" })])?.pane).toBe("own");
});

test("a start goes to the session on the PR's branch, whatever its tab is called", () => {
  const plan = planStart({ item: "chore/stop-check", pr: "o/repo#749", kind: "conflicts", branch: "chore/stop-check" },
    [{ pane: "w1", label: "w1-bp-p1", name: "w1", status: "idle", branch: "chore/stop-check" }]);
  expect(plan).toEqual({ reuse: { pane: "w1", fresh: false } });
  const busy = planStart({ item: "x", pr: "o/repo#749", kind: "conflicts", branch: "chore/stop-check" },
    [{ pane: "w1", label: "w1-bp-p1", name: "w1", status: "working", branch: "chore/stop-check" }]);
  expect("refuse" in busy).toBe(true);
});

test("a session started outside the board on a branch another live session owns is warned first", () => {
  const it = { key: "ABC-1", agents: [agent({ name: "cr-a", session: "s1", branch: "ABC-1-fix", status: "working" })] } as unknown as WorkItem;
  expect(sessionContext(it, "ABC-1-fix", "s2", "VIEW")).toStartWith("Another session already owns branch ABC-1-fix: cr-a (working)");
  expect(sessionContext(it, "ABC-1-fix", "s1", "VIEW")).toBe("This session is on work item ABC-1. Its board view:\n\nVIEW");
});
