import { describe, expect, test } from "bun:test";
import type { Agent, PrRow, ReviewDrafts } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { reviewersToClose, tookIt, transcriptPath } from "./handover";
import { selfReviewLine } from "./tellagents";

const pr = (over: Partial<PrRow> = {}): PrRow => ({
  repo: "acme/widgets", number: 7, title: "ABC-1: a change", url: "https://github.com/acme/widgets/pull/7", author: "me", draft: false,
  updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: [], branch: "abc-1-change", base: "main", head: "abc1234", id: "PR_7",
  merge_state: "BLOCKED", can_merge: "needs approval", review_decision: null, last_activity: "2030-01-01T00:00:00Z", role: "mine",
  state: "address", feedback: [], rerequest: [], mark: null, superseded: null, ...over,
});
const agent = (over: Partial<Agent> = {}): Agent => ({
  pane: "w1:p1", tab: "w1:t1", workspace: "w1", name: null, label: "ABC-1 fix", title: "", workspaceLabel: "ws", status: "idle",
  cwd: "/tmp/x", repo: "widgets", branch: "abc-1-change", session: "s-impl", focused: false, seq: 1, finishedSeq: null, ...over,
});
const drafts: ReviewDrafts = { pr: "acme/widgets#7", sha: "abc1234ffff", posted: null, findings: [] };
const line = selfReviewLine(drafts);
const user = (content: unknown) => JSON.stringify({ type: "user", message: { role: "user", content } });
const reply = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "on it" }] } });

describe("tookIt", () => {
  test("the tell as a user turn, then a reply", () => {
    expect(tookIt([user(`New feedback came in:\n- ${line} found 2:`), reply].join("\n"), line)).toBe(true);
  });
  test("the tell in content blocks counts too", () => {
    expect(tookIt([user([{ type: "text", text: `- ${line} found 2:` }]), reply].join("\n"), line)).toBe(true);
  });
  test("not yet answered, or only mentioned by the assistant", () => {
    expect(tookIt(user(`- ${line} found 2:`), line)).toBe(false);
    expect(tookIt([reply, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: line }] } })].join("\n"), line)).toBe(false);
  });
  test("a reply before the tell doesn't count", () => {
    expect(tookIt([reply, user(`- ${line}`)].join("\n"), line)).toBe(false);
  });
});

describe("reviewersToClose", () => {
  const reviewer = agent({ pane: "w1:p2", label: "selfreview widgets#7", branch: null, session: "s-rev" });
  const implementer = agent();
  const took = [user(`- ${line} found 2:`), reply].join("\n");
  const run = (agents: Agent[], transcript: string | null = took, d: ReviewDrafts | null = drafts) =>
    reviewersToClose(groupWorkItems([pr()], agents), () => d, (a) => (a.session === "s-impl" ? transcript : null));

  test("closes the self-review once the PR's own session took its findings", () => {
    expect(run([reviewer, implementer])).toMatchObject([{ pane: "w1:p2", ref: "acme/widgets#7", sha: "abc1234ffff" }]);
  });
  test("keeps it while the owner hasn't taken them", () => {
    expect(run([reviewer, implementer], user(`- ${line}`))).toEqual([]);
    expect(run([reviewer, implementer], null)).toEqual([]);
  });
  test("keeps it while it works or waits on a dialog", () => {
    expect(run([{ ...reviewer, status: "working" }, implementer])).toEqual([]);
    expect(run([{ ...reviewer, status: "blocked" }, implementer])).toEqual([]);
  });
  test("keeps it when there's no owner to have taken them, or no drafts", () => {
    expect(run([reviewer])).toEqual([]);
    expect(run([reviewer, implementer], took, null)).toEqual([]);
  });
  test("a tell about another commit doesn't count", () => {
    expect(run([reviewer, implementer], took, { ...drafts, sha: "def5678" })).toEqual([]);
  });
});

test("a transcript lives under the session's cwd with / and . as -", () => {
  expect(transcriptPath(agent({ cwd: "/Users/me/Projects/widgets/.claude/worktrees/cr-widgets-7", session: "abc" })))
    .toEndWith("/projects/-Users-me-Projects-widgets--claude-worktrees-cr-widgets-7/abc.jsonl");
});
