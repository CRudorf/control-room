import { expect, test } from "bun:test";
import type { PrRow, WorkItem } from "../shared/types";
import { withLookup } from "./handoff";
import { addNote, decisionTells, notesFor, notesPrompt, removeNote } from "./notes";
import { seenOf, sinceLine, standalone } from "./since";

const pr = (o: Partial<PrRow> = {}): PrRow => ({
  repo: "o/gizmo", number: 5, title: "t", url: "u", author: "pat", draft: false, updated: "", checks: "pending", pending_reviewers: [],
  branch: "b", base: "main", head: "aaa", id: "1", merge_state: "CLEAN", can_merge: "no", review_decision: null, last_activity: "", role: "mine", feedback: [], ...o,
});
const item = (prs: PrRow[]) => ({ id: "x-1", key: "X-1", prs } as unknown as WorkItem);
const now = new Date("2030-03-04T15:00:00");

test("nothing changed since the user looked says so, with when", () => {
  const it = item([pr()]);
  expect(sinceLine(it, seenOf(it, "2030-03-04T14:05:00"), now)).toMatch(/^nothing new since 2:05/);
});

test("new threads, a push, CI and conflicts since the user looked are named", () => {
  const before = item([pr()]);
  const seen = seenOf(before, "2030-03-04T14:05:00");
  const after = item([pr({ head: "bbb", checks: "failure", merge_state: "DIRTY", feedback: [
    { kind: "thread", who: "coderabbit", bot: true, url: "t1", at: "", body: "" },
    { kind: "thread", who: "sam", bot: false, url: "t2", at: "", body: "" },
  ] })]);
  expect(sinceLine(after, seen, now)).toBe("since 2:05 PM: 2 new threads on #5 (1 bot), pushed to #5, CI failing on #5, conflicts on #5");
});

test("no baseline, no line", () => {
  expect(sinceLine(item([pr()]), null, now)).toBeNull();
});

test("a stacked PR doesn't stand alone", () => {
  expect(standalone(pr())).toBe("stands alone");
  expect(standalone(pr({ stack: { on: "o/gizmo#4", number: 4, branch: "x", head: "h", behind: false } }))).toContain("stacked on #4");
  expect(standalone(pr({ base: "feature/x" }))).toContain("based on feature/x");
});

test("a decision is kept once, by key in any case, and goes into every prompt on the item", () => {
  const a = addNote("NOTE-9", "  no soak period  ");
  expect(addNote("note-9", "No soak period").id).toBe(a.id);
  expect(notesFor(["Note-9"]).map((n) => n.text)).toEqual(["no soak period"]);
  const p = withLookup("Fix it.", "NOTE-9", notesFor(["NOTE-9"]));
  expect(p).toContain("Decisions already made on this work item. Follow them and don't reopen them:\n- no soak period");
  expect(p).toContain('item NOTE-9 --note "<the decision>"');
  removeNote(a.id);
  expect(notesFor(["NOTE-9"])).toEqual([]);
});

test("a new decision reaches the sessions already running on the item, but not the one that recorded it or one stuck on a dialog", () => {
  const a = (pane: string, cwd: string, status = "working") => ({ pane, cwd, status } as WorkItem["agents"][number]);
  const it = { key: "X-1", agents: [a("p1", "/w/one"), a("p2", "/w/two"), a("p3", "/w/three", "blocked"), { ...a("p4", "/w/four"), spent: { reason: "", output: null, since: "", closesAt: null } }] } as unknown as WorkItem;
  const tells = decisionTells(it, { text: "no soak period" }, "/w/two/src");
  expect(tells.map((t) => t.pane)).toEqual(["p1"]);
  expect(tells[0].text).toStartWith("A decision was just recorded on work item X-1: no soak period");
  expect(decisionTells(it, { text: "x" }, null).map((t) => t.pane)).toEqual(["p1", "p2"]);
});

test("the same decision added twice isn't new, so nobody is told twice", () => {
  expect(addNote("DUP-1", "keep it").fresh).toBe(true);
  expect(addNote("dup-1", "Keep it").fresh).toBe(false);
});

test("with no decisions, the prompt still says how to record one", () => {
  expect(notesPrompt("K-1", [], "item")).toBe('When I settle something about this work item (a scope cut, "don\'t do X", a name, a choice between options), record it in one line so later sessions know: `item K-1 --note "<the decision>"`.');
});
