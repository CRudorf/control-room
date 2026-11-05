import { expect, test } from "bun:test";
import type { PrRow, ReviewDrafts } from "../shared/types";
import { planStart } from "./handoff";
import { DELTA_MARK, proposeVerdict, reviewStart, stripRank } from "./review";

const p = { repo: "o/gizmo", number: 7, title: "gizmo", head: "bbbbbbbb22", role: "requested" } as PrRow;
const drafts = (sha: string, ranks: string[] = [], posted: ReviewDrafts["posted"] = null): ReviewDrafts => ({
  pr: "o/gizmo#7", sha, posted,
  findings: ranks.map((rank, id) => ({ id, path: `src/${id}.ts`, line: id + 1, start_line: null, rank: rank as any, title: `t${id}`, body: `b${id}` })),
});

test("a review start with no earlier drafts is the full review", () => {
  expect(reviewStart(p, 2, false, null)).toContain("multi-persona review");
});

test("drafts at an older commit make the start a re-check of what changed since", () => {
  const s = reviewStart(p, 2, false, drafts("aaaaaaaa11", ["nit"]))!;
  expect(s).toContain(DELTA_MARK);
  expect(s).toContain("git diff aaaaaaaa11..bbbbbbbb22");
  expect(s).not.toContain("multi-persona review on");
});

test("a posted review at an older commit is re-checked too, and says what it posted", () => {
  const s = reviewStart(p, 2, false, drafts("aaaaaaaa11", [], { at: "2030-01-02T00:00:00Z", url: "u", event: "APPROVE", count: 0 }))!;
  expect(s).toContain("posted 2030-01-02 as approve");
});

test("drafts already at the head mean there is nothing new to review", () => {
  expect(reviewStart(p, 2, false, drafts("bbbbbbbb"))).toBeNull();
});

test("nothing blocking proposes approve: important and should-do inline, the rest in a summary", () => {
  const v = proposeVerdict(drafts("bbbbbbbb22", ["important", "should-do", "nit"]));
  expect(v.event).toBe("APPROVE");
  expect(v.picked).toEqual([0, 1]);
  expect(v.summary).toContain("Non-blocking:\n- t2 (`src/2.ts:3`)");
});

test("a blocking finding proposes request changes with everything but nits", () => {
  const v = proposeVerdict(drafts("bbbbbbbb22", ["blocking", "should-do", "nit"]));
  expect(v.event).toBe("REQUEST_CHANGES");
  expect(v.picked).toEqual([0, 1]);
  expect(v.summary).toBe("");
});

test("after a push nothing goes inline: the findings move to the summary", () => {
  const v = proposeVerdict(drafts("aaaa", ["important"]), true);
  expect(v.picked).toEqual([]);
  expect(v.summary).toContain("t0");
});

test("a finding outside the diff can't go inline", () => {
  expect(proposeVerdict(drafts("b", ["important", "important"]), false, [1]).picked).toEqual([0]);
});

test("rank labels never reach the posted body", () => {
  for (const b of ["**Important:** loop stops early", "Nit: loop stops early", "[should-do] loop stops early", "nitpick - loop stops early", "(blocking) loop stops early"])
    expect(stripRank(b)).toBe("loop stops early");
  expect(stripRank("Important to note: the loop")).toBe("Important to note: the loop");
  expect(stripRank("Blocking calls stall the loop")).toBe("Blocking calls stall the loop");
  expect(stripRank("loop stops early")).toBe("loop stops early");
});

test("a re-review reuses the free helper session", () => {
  const plan = planStart({ item: "o/gizmo#7", pr: "o/gizmo#7", kind: "review" }, [{ pane: "p1", label: "review gizmo#7", name: "cr-review", status: "idle" }]);
  expect(plan).toEqual({ reuse: { pane: "p1", fresh: true } });
});
