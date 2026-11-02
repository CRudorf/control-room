import { describe, expect, test } from "bun:test";
import type { Agent, PrRow } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { findItem, formatItem, MAX_CHARS } from "./itemview";

let n = 100;
function pr(over: Partial<PrRow>): PrRow {
  n++;
  return {
    repo: "acme/widgets", number: n, title: "ABC-12: a change", url: `https://github.com/acme/widgets/pull/${n}`,
    author: "me", draft: false, updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: ["pat"],
    branch: `branch-${n}`, base: "main", head: "abc", id: `PR_${n}`, merge_state: "BLOCKED", can_merge: "needs approval",
    review_decision: "REVIEW_REQUIRED", last_activity: "2030-01-01T00:00:00Z", role: "mine", state: "waiting",
    feedback: [], rerequest: [], mark: null, superseded: null, ...over,
  };
}

const agent = (over: Partial<Agent>): Agent => ({
  pane: "w1:p1", tab: "w1:t1", workspace: "w1", name: "cr-widgets-101", label: "feedback widgets#101", title: "", workspaceLabel: "ws",
  status: "working", cwd: "/tmp/widgets", repo: "widgets", branch: "branch-101", session: null, focused: false, seq: 1, finishedSeq: null, ...over,
});

const fb = (who: string, body: string) => ({ kind: "thread" as const, who, bot: false, url: "u", at: "2030-01-02T00:00:00Z", body, where: "src/a.ts:3" });

describe("finding a work item", () => {
  const items = groupWorkItems([pr({ number: 7 }), pr({ number: 8, title: "other", branch: "other-thing", role: "requested" })]);
  test("by key or id, any case", () => {
    expect(findItem(items, "ABC-12")?.key).toBe("ABC-12");
    expect(findItem(items, "abc-12")?.key).toBe("ABC-12");
  });
  test("by PR ref or URL", () => {
    expect(findItem(items, "widgets#7")?.key).toBe("ABC-12");
    expect(findItem(items, "acme/widgets#7")?.key).toBe("ABC-12");
    expect(findItem(items, "https://github.com/acme/widgets/pull/8")?.keyKind).toBe("review");
  });
  test("nothing for an unknown ref", () => {
    expect(findItem(items, "widgets#9")).toBeNull();
    expect(findItem(items, "")).toBeNull();
  });
});

describe("the item view", () => {
  test("key, lane, PRs, feedback, failing checks, lessons and agents", () => {
    const [it] = groupWorkItems(
      [pr({ number: 101, branch: "branch-101", checks: "failure", state: "address", feedback: [fb("pat", "Rename this.\n\nIt reads as a verb.")] })],
      [agent({})],
    );
    const text = formatItem(it, [{ repo: "acme/widgets", ref: "acme/widgets#90", text: "Run the migration check.", at: "2030-01-01T00:00:00Z" }]);
    expect(text.split("\n")[0]).toStartWith("ABC-12 (a change): my turn");
    expect(text).toContain("widgets#101 \"ABC-12: a change\"");
    expect(text).toContain("CI failure");
    expect(text).toContain("failing checks: gh pr checks 101 -R acme/widgets");
    expect(text).toContain("- pat at src/a.ts:3: Rename this. It reads as a verb.");
    expect(text).toContain("- Run the migration check. (acme/widgets#90)");
    expect(text).toContain("- cr-widgets-101: working on branch-101 in /tmp/widgets");
  });

  test("long feedback is clipped and the whole view stays short", () => {
    const many = Array.from({ length: 12 }, (_, i) => fb(`r${i}`, "x".repeat(2_000)));
    const items = groupWorkItems(Array.from({ length: 10 }, () => pr({ state: "address", feedback: many })));
    const text = formatItem(items[0], []);
    expect(text).toContain("+ 4 more on the PR");
    expect(text).not.toContain("x".repeat(300));
    expect(text.length).toBeLessThanOrEqual(MAX_CHARS + 60);
    expect(text).toEndWith("open the PRs for the rest");
  });

  test("an item with no PRs or agents says so", () => {
    const [it] = groupWorkItems([], [agent({ label: "task-tidy-up", repo: null, branch: null, status: "blocked" })]);
    const text = formatItem({ ...it, agents: [] }, []);
    expect(text).toContain("No PRs yet.");
    expect(text).toContain("No agents on it.");
  });
});
