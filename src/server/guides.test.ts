import { describe, expect, test } from "bun:test";
import type { Agent, PrRow } from "../shared/types";
import { groupWorkItems } from "./workitems";
import { MAX_GUIDES, toGuide } from "./guides";

const pr = (n: number, over: Partial<PrRow> = {}): PrRow => ({
  repo: "acme/widgets", number: n, title: `a change ${n}`, url: `https://github.com/acme/widgets/pull/${n}`, author: "sam", draft: false,
  updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: [], branch: `b${n}`, base: "main", head: `h${n}`, id: `PR_${n}`,
  merge_state: "BLOCKED", can_merge: "needs approval", review_decision: null, last_activity: "2030-01-01T00:00:00Z", role: "requested",
  state: "waiting", feedback: [], rerequest: [], mark: null, superseded: null, ...over,
});
const agent = (n: number, status: Agent["status"]): Agent => ({
  pane: `w1:p${n}`, tab: `w1:t${n}`, workspace: "w1", name: `cr-widgets-${n}`, label: `review widgets#${n}`, title: "", workspaceLabel: "ws", status,
  cwd: "/tmp/x", repo: "widgets", branch: `b${n}`, session: null, focused: false, seq: n, finishedSeq: null,
});
const refs = (r: { p: PrRow }[]) => r.map((x) => x.p.number);

describe("toGuide", () => {
  test("a new review request gets a guide, once per head", () => {
    const items = groupWorkItems([pr(1)]);
    expect(refs(toGuide(items, {}, false))).toEqual([1]);
    expect(toGuide(items, { "acme/widgets#1": "h1" }, false)).toEqual([]);
    expect(refs(toGuide(groupWorkItems([pr(1, { head: "h2" })]), { "acme/widgets#1": "h1" }, false))).toEqual([1]);
  });

  test("a current guide is enough; a stale one is redone", () => {
    const [it] = groupWorkItems([pr(1)]);
    const g = { ref: "acme/widgets#1", path: "/guide/x", sha: "h1", at: "2030-01-01T00:00:00Z", url: null };
    expect(toGuide([{ ...it, guide: [{ ...g, stale: false }] }], {}, false)).toEqual([]);
    expect(refs(toGuide([{ ...it, guide: [{ ...g, stale: true }] }], {}, false))).toEqual([1]);
  });

  test("leaves others' drafts and items with a busy agent alone", () => {
    expect(toGuide(groupWorkItems([pr(2, { draft: true })]), {}, false)).toEqual([]);
    expect(toGuide(groupWorkItems([pr(1)], [agent(1, "working")]), {}, false)).toEqual([]);
  });

  test("waits for room: running review agents count, and low memory stops it", () => {
    const items = groupWorkItems([pr(1), pr(2), pr(3), pr(4)], [agent(4, "working")]);
    expect(toGuide(items, {}, false)).toHaveLength(MAX_GUIDES - 1);
    expect(toGuide(groupWorkItems([pr(1)]), {}, true)).toEqual([]);
  });

  test("my own PR gets one self-review, after anyone waiting on mine", () => {
    const mine = pr(5, { role: "mine", author: "me", draft: true });
    const r = toGuide(groupWorkItems([mine, pr(1)]), {}, false, {});
    expect(r.map((x) => [x.p.number, x.own])).toEqual([[1, false], [5, true]]);
    expect(toGuide(groupWorkItems([mine]), {}, false, { "acme/widgets#5": "h5" })).toEqual([]);
    expect(toGuide(groupWorkItems([{ ...mine, merge_queue: { position: 1, state: "QUEUED" } as PrRow["merge_queue"] }]), {}, false, {})).toEqual([]);
  });
});
