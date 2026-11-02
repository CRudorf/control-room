import { afterEach, describe, expect, test } from "bun:test";
import type { ItemBranch, Issue, AcceptanceFacts } from "../shared/types";
import { branchLine } from "../shared/branches";
import { applyJira, approvedShipped } from "./workitems";
import { outcomeOf, questionOpen, acceptanceLane } from "./acceptance";
import { bounces, bounceOf, recordBounces } from "./product";
import { branchesFor, nameHasKey, repoOf, scanRepo, type BranchStore } from "./branches";
import { db } from "./db";
import { setAdapter, type Adapter } from "./runner";

const t = (over: Partial<AcceptanceFacts> = {}): AcceptanceFacts => ({ enteredAt: "2026-10-28T10:00:00Z", failed: null, lastComment: null, lastMyCommentAt: null, questionSince: null, ...over });
const issue = (over: Partial<Issue>): Issue => ({
  key: "ABC-1", summary: "a thing", status: "Testing", category: "indeterminate", mine: true, updated: "2026-10-28T00:00:00Z",
  url: "https://x.atlassian.net/browse/ABC-1", transitions: [], testing: t(), ...over,
});
const br = ({ onStaging = true, onMaster = false as boolean | null, name = "ABC-1", lastCommitAt }: { onStaging?: boolean | null; onMaster?: boolean | null; name?: string; lastCommitAt?: string }): ItemBranch => ({ repo: "acme/widgets", name, stages: [{ name: "staging", in: onStaging }, { name: "master", in: onMaster }], lastCommitAt: lastCommitAt ?? "2026-10-28T00:00:00Z" });
const comment = (id: string, at: string, isMe = false) => ({ id, author: isMe ? "Pat" : "Pat", isMe, at, firstLine: `comment ${id}` });

describe("question detection", () => {
  test("no comments: no question", () => expect(questionOpen(t())).toBe(false));
  test("someone else's comment after the move into Testing is a question", () =>
    expect(questionOpen(t({ questionSince: "2026-10-29T00:00:00Z", lastComment: comment("1", "2026-10-29T00:00:00Z") }))).toBe(true));
  test("a comment from before the move into Testing is not", () =>
    expect(questionOpen(t({ questionSince: "2026-10-27T00:00:00Z" }))).toBe(false));
  test("Pat's reply after the question closes it", () =>
    expect(questionOpen(t({ questionSince: "2026-10-29T00:00:00Z", lastMyCommentAt: "2026-10-30T00:00:00Z" }))).toBe(false));
  test("a question after Pat's reply opens again", () =>
    expect(questionOpen(t({ questionSince: "2026-10-31T00:00:00Z", lastMyCommentAt: "2026-10-30T00:00:00Z" }))).toBe(true));
  test("offsets compare as instants", () =>
    expect(questionOpen(t({ enteredAt: "2026-10-28T09:00:00-0700", questionSince: "2026-10-28T15:30:00Z" }))).toBe(false));
});

describe("acceptanceLane", () => {
  test("Testing with no question waits on product, with merged PRs", () => {
    const l = acceptanceLane(issue({}), [], ["widgets#12"])!;
    expect([l.lane, l.why]).toEqual(["waiting", "Product testing on staging · merged widgets#12"]);
  });
  test("a question is My turn and opens Jira", () => {
    const l = acceptanceLane(issue({ testing: t({ questionSince: "2026-10-29T00:00:00Z", lastComment: comment("9", "2026-10-29T00:00:00Z") }) }), [], [])!;
    expect([l.lane, l.why, l.primary.url]).toEqual(["mine", "Product asked a question · “comment 9”", "https://x.atlassian.net/browse/ABC-1"]);
  });
  test("a fail is My turn and starts an agent with the failure as context", () => {
    const j = issue({ status: "To Do", category: "new", testing: t({ enteredAt: "2026-10-25T00:00:00Z", failed: { id: "77", by: "Pat Mortvedt", at: "2026-10-26T00:00:00Z", from: "Testing", to: "To Do", comment: { id: "5", at: "2026-10-26T00:00:00Z", firstLine: "still broken on case 73" } } }) });
    const l = acceptanceLane(j, [], [])!;
    expect([l.lane, l.why, l.primary.start]).toEqual(["mine", "Failed testing (by Pat Mortvedt) · “still broken on case 73”", "ABC-1"]);
    expect(l.primary.startContext).toContain("still broken on case 73");
  });
  test("a question, then a fail, then Pat's reply: still My turn, Failed testing", () => {
    const failed = { id: "77", by: "Pat", at: "2026-10-29T12:00:00Z", from: "Testing", to: "To Do", comment: null };
    const j = issue({ status: "To Do", category: "new", testing: t({ questionSince: "2026-10-29T00:00:00Z", failed, lastMyCommentAt: "2026-10-30T00:00:00Z", lastComment: comment("10", "2026-10-30T00:00:00Z", true) }) });
    const l = acceptanceLane(j, [], [])!;
    expect([l.lane, l.why.startsWith("Failed testing")]).toEqual(["mine", true]);
  });
  test("a fail, then the issue enters Testing again: Waiting on others", () => {
    const failed = { id: "77", by: "Pat", at: "2026-10-29T12:00:00Z", from: "Testing", to: "To Do", comment: null };
    const l = acceptanceLane(issue({ status: "Testing", testing: t({ failed, enteredAt: "2026-10-30T09:00:00Z" }) }), [], [])!;
    expect([l.outcome, l.lane]).toEqual(["testing", "waiting"]);
  });
  test("approved asks for a master PR, is Parked with no branch, and is finished on master", () => {
    const j = issue({ status: "Ready for Deployment" });
    const l = acceptanceLane(j, [br({})], [])!;
    expect([l.lane, l.primary.label, l.primary.start]).toEqual(["mine", "PR ABC-1 to master", "ABC-1"]);
    expect(l.primary.startContext).toContain("against master");
    expect(acceptanceLane(j, [], [])!.note).toBe("Approved, waiting for master · no ABC-1 branch found");
    expect(acceptanceLane(j, [br({ onMaster: true })], [])!.finished).toBe(true);
    expect(approvedShipped(new Map([["ABC-1", j]]), () => [br({ onMaster: true })]).map((x) => x.key)).toEqual(["ABC-1"]);
  });
  test("someone else's issue is not product testing", () => expect(outcomeOf(issue({ mine: false }))).toBeNull());
});

describe("applyJira and product testing", () => {
  test("Testing and Ready for Deployment never say no PR yet or Start", () => {
    const items = applyJira([], new Map([
      ["ABC-1", issue({})], ["ABC-2", issue({ key: "ABC-2", status: "Ready for Deployment" })],
      ["ABC-3", issue({ key: "ABC-3", testing: undefined })], ["ABC-4", issue({ key: "ABC-4", status: "Ready for Deployment", testing: undefined })],
    ]));
    expect(items.map((i) => [i.key, i.lane])).toEqual([["ABC-1", "waiting"], ["ABC-2", "parked"], ["ABC-3", "waiting"], ["ABC-4", "parked"]]);
    expect(items.some((i) => i.primary.start || /no PR yet/.test(i.why))).toBe(false);
  });
  test("an approved issue on master leaves the board", () => {
    expect(applyJira([], new Map([["ABC-2", issue({ key: "ABC-2", status: "Ready for Deployment" })]]), { branchesFor: () => [br({ name: "ABC-2", onMaster: true })] })).toEqual([]);
  });
  test("an In Progress issue with a branch shows the branch, not no PR yet", () => {
    const [it] = applyJira([], new Map([["ABC-5", issue({ key: "ABC-5", status: "In Progress", testing: undefined })]]), { branchesFor: () => [br({ name: "ABC-5" })] });
    expect(it.why).toBe("In Progress in the tracker · ABC-5 · on staging, not on master");
    expect(it.branches?.length).toBe(1);
  });
});

describe("branch subline", () => {
  test("says where the newest branch is", () => {
    expect(branchLine([br({ name: "ABC-6932" })])).toBe("ABC-6932 · on staging, not on master");
    expect(branchLine([br({ onMaster: true })])).toBe("ABC-1 · on master");
    expect(branchLine([br({ onStaging: false })])).toBe("ABC-1 · not on staging");
    expect(branchLine([br({ name: "old", lastCommitAt: "2026-01-01T00:00:00Z" }), br({ name: "ABC-1-stage" })])).toBe("ABC-1-stage · on staging, not on master +1");
    expect(branchLine([])).toBe("");
  });
});

describe("branch key matching", () => {
  test("word boundary, case, suffixes", () => {
    expect(nameHasKey("ABC-6942", "ABC-6942")).toBe(true);
    expect(nameHasKey("ABC-6942-stage", "ABC-6942")).toBe(true);
    expect(nameHasKey("pat/abc-6942-fix", "ABC-6942")).toBe(true);
    expect(nameHasKey("ABC-69420", "ABC-6942")).toBe(false);
    expect(nameHasKey("XABC-6942", "ABC-6942")).toBe(false);
  });
  test("repoOf reads ssh and https remotes", () => {
    expect(repoOf("git@github.com:acme/widgets.git\n")).toBe("acme/widgets");
    expect(repoOf("https://github.com/acme/widgets")).toBe("acme/widgets");
  });
  test("branchesFor filters the cache by key", () => {
    const s: BranchStore = { "acme/widgets": { at: "", branches: [{ ...br({ name: "ABC-1" }), sha: "a" }, { ...br({ name: "ABC-10" }), sha: "b" }] } };
    expect(branchesFor("ABC-1", s).map((b) => b.name)).toEqual(["ABC-1"]);
  });
});

describe("master-merge check through the runner", () => {
  afterEach(() => setAdapter(null));
  test("flags come from merge-base --is-ancestor; a missing base is null", async () => {
    const calls: string[][] = [];
    const adapter: Adapter = async (cmd) => {
      calls.push(cmd);
      const sub = cmd.slice(3).join(" ");
      if (sub.startsWith("fetch")) return { out: "", err: "", code: 0 };
      if (sub.startsWith("for-each-ref")) return { out: "origin/ABC-1|aaa|2026-10-28T00:00:00Z\norigin/ABC-10|bbb|2026-10-28T00:00:00Z\norigin/ABC-2|ccc|2026-10-29T00:00:00Z\norigin/master|ddd|x\norigin/staging|eee|x\n", err: "", code: 0 };
      if (sub.startsWith("remote")) return { out: "git@github.com:acme/widgets.git\n", err: "", code: 0 };
      if (sub.startsWith("merge-base")) {
        const [, , b, base] = cmd.slice(3);
        const yes = (b === "origin/ABC-1") || (b === "origin/ABC-2" && base === "origin/staging");
        return { out: "", err: "", code: yes ? 0 : 1 };
      }
      return { out: "", err: "nope", code: 1 };
    };
    setAdapter(adapter, false);
    const got = await scanRepo("/x", ["ABC-1", "ABC-2"]);
    expect(got.map((b) => [b.name, b.stages[0].in, b.stages[1].in])).toEqual([["ABC-1", true, true], ["ABC-2", true, false]]);
    expect(calls[0]).toEqual(["git", "-C", "/x", "fetch", "--prune", "-q", "origin"]);
  });
  test("a repo without staging leaves that stage null", async () => {
    setAdapter(async (cmd) => {
      const sub = cmd[3];
      if (sub === "for-each-ref") return { out: "origin/ABC-1|a|2026-10-28T00:00:00Z\norigin/master|m|x\n", err: "", code: 0 };
      if (sub === "remote") return { out: "git@github.com:acme/widgets.git", err: "", code: 0 };
      return { out: "", err: "", code: 0 };
    }, false);
    const [b] = await scanRepo("/x", ["ABC-1"]);
    expect([b.stages[0].in, b.stages[1].in]).toEqual([null, true]);
  });
});

describe("product bounces", () => {
  test("one record per question or fail, deduped by comment or changelog id", () => {
    db.exec("DELETE FROM product_events");
    const q = issue({ key: "ABC-9", testing: t({ questionSince: "2026-10-29T00:00:00Z", lastComment: comment("41", "2026-10-29T00:00:00Z") }) });
    expect(bounceOf(q)?.ref).toBe("ABC-9:q:41");
    expect(recordBounces([q], () => [], () => ["widgets#3"]).length).toBe(1);
    expect(recordBounces([q], () => [], () => ["widgets#3"]).length).toBe(0);
    const again = issue({ key: "ABC-9", testing: t({ questionSince: "2026-10-30T00:00:00Z", lastComment: comment("42", "2026-10-30T00:00:00Z") }) });
    expect(recordBounces([again], () => [], () => []).length).toBe(1);
    const failed = issue({ key: "ABC-8", status: "To Do", category: "new", testing: t({ enteredAt: "2026-10-25T00:00:00Z", failed: { id: "7", by: "B", at: "2026-10-26T00:00:00Z", from: "Testing", to: "To Do", comment: null } }) });
    expect(recordBounces([failed, failed], () => [br({ name: "ABC-8" })], () => []).map((b) => [b.kind, b.branch])).toEqual([["failed-testing", "acme/widgets@ABC-8"]]);
    expect(bounces().map((b) => b.ref).sort()).toEqual(["ABC-8:fail:7", "ABC-9:q:41", "ABC-9:q:42"]);
    expect(db.query<{ n: number }, []>("SELECT COUNT(*) n FROM action_records WHERE action IN ('product-question', 'failed-testing')").get()!.n).toBe(3);
  });
});

test("a branch carries a key of any shape: a tracker's or an error report's", () => {
  expect(nameHasKey("fix/ABC-3-CLIENT-N-retry", "ABC-3-CLIENT-N")).toBe(true);
  expect(nameHasKey("abc-12-stage", "ABC-12")).toBe(true);
  expect(nameHasKey("abc-123", "ABC-12")).toBe(false);
});
