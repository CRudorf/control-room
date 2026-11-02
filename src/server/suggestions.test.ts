import { afterEach, describe, expect, test } from "bun:test";
import type { Suggestion, WorkItem } from "../shared/types";
import { db } from "./db";
import { setAdapter, type Adapter } from "./runner";
import { dismissSuggestion, factsOf, fingerprint, isDismissed, isPicked, livePicked, parseVerdicts, pickedNow, pickupSuggestion, rankSuggestions, setSuggestionsForTest, suggestionsView } from "./suggestions";
import { applyPicked } from "./workitems";

const s = (key: string, o: Partial<Suggestion> = {}): Suggestion => ({
  key, summary: key, source: "a", status: "To Do", priority: "Medium", assignee: null, labels: [], parent: null, links: [],
  updated: null, rank: 0, url: null, verdict: null, of: null, reason: null, facts: { board: [], prs: [] }, boost: 0, ...o,
});
const keys = (xs: Suggestion[]) => xs.map((x) => x.key);

afterEach(() => setAdapter(null));

describe("rankSuggestions", () => {
  test("an issue blocked by an open issue, or judged wait, is not offered", () => {
    const blocked = s("ABC-6695", { links: [{ type: "is blocked by", direction: "inward", key: "ABC-6770", status: "To Do", done: false }] });
    const freed = s("ABC-1", { links: [{ type: "is blocked by", direction: "inward", key: "ABC-2", status: "Done", done: true }] });
    const blocks = s("ABC-3", { links: [{ type: "blocks", direction: "outward", key: "ABC-4", status: "To Do", done: false }] });
    const waits = s("ABC-5", { verdict: "wait" } as Partial<Suggestion>);
    expect(keys(rankSuggestions([blocked, freed, blocks, waits], {}))).toEqual(["ABC-1", "ABC-3"]);
  });

  test("source order, then mine, then boost, then rank", () => {
    const all = [s("C1", { source: "c" }), s("B1", { source: "b" }), s("A2", { rank: 1 }), s("A1", { rank: 0 }),
      s("A3", { rank: 5, assignee: "me" }), s("A4", { rank: 9, boost: 2 }), s("X1", { source: "architecture" })];
    expect(keys(rankSuggestions(all, {}))).toEqual(["A3", "A4", "A1", "A2", "B1", "C1", "X1"]);
  });
  test("other backlog only shows when a to c give nothing usable", () => {
    const d = s("D1", { source: "d" });
    expect(keys(rankSuggestions([s("A1"), d], {}))).toEqual(["A1"]);
    expect(keys(rankSuggestions([s("A1", { verdict: "wait" }), s("B1", { source: "b", verdict: "duplicate" }), d], {}))).toEqual(["B1", "D1"]);
    expect(keys(rankSuggestions([s("A1"), d], { A1: { reason: "", fp: fingerprint(s("A1")), at: "" } }))).toEqual(["D1"]);
  });
});

describe("dismissal", () => {
  test("holds until status, assignee or priority changes", () => {
    const a = s("ABC-1");
    const d = { "ABC-1": { reason: "no", fp: fingerprint(a), at: "" } };
    expect(isDismissed(a, d)).toBe(true);
    expect(isDismissed({ ...a, priority: "High" }, d)).toBe(false);
    expect(isDismissed({ ...a, assignee: "me" }, d)).toBe(false);
    expect(isDismissed({ ...a, status: "Blocked" }, d)).toBe(false);
  });
  test("dismissSuggestion stores the fingerprint and records it", () => {
    setSuggestionsForTest([s("ABC-2")]);
    dismissSuggestion("ABC-2", "later");
    const r = db.query<{ action: string; sent: string; result: string }, []>("SELECT * FROM action_records ORDER BY id DESC LIMIT 1").get()!;
    expect(r).toMatchObject({ action: "dismiss-suggestion", sent: "ABC-2", result: "later" });
    expect(() => dismissSuggestion("NOPE-1")).toThrow();
  });
});

describe("parseVerdicts", () => {
  test("reads the CLI wrapper and plain arrays", () => {
    const arr = [{ key: "ABC-1", verdict: "free", of: null, reason: "no links" }, { key: "ABC-2", verdict: "with", of: "ABC-9", reason: "same epic" }];
    expect(parseVerdicts(JSON.stringify({ type: "result", result: "Here:\n```json\n" + JSON.stringify(arr) + "\n```" }))).toEqual({
      "ABC-1": { verdict: "free", of: null, reason: "no links" }, "ABC-2": { verdict: "with", of: "ABC-9", reason: "same epic" } });
    expect(Object.keys(parseVerdicts(JSON.stringify(arr)))).toEqual(["ABC-1", "ABC-2"]);
  });
  test("throws on junk", () => {
    expect(() => parseVerdicts("I can't help with that")).toThrow();
    expect(() => parseVerdicts(JSON.stringify({ result: "[not json" }))).toThrow();
  });
  test("drops malformed entries and keeps the rest", () => {
    const out = parseVerdicts(JSON.stringify([{ key: "A-1", verdict: "maybe" }, { verdict: "free" }, null, { key: "A-2", verdict: "wait", reason: 3 }]));
    expect(out).toEqual({ "A-2": { verdict: "wait", of: null, reason: "" } });
  });
});

describe("pickupSuggestion", () => {
  const fake = () => {
    const calls: string[][] = [];
    const adapter: Adapter = async (cmd) => { calls.push(cmd); return { out: "ok", err: "", code: 0 }; };
    return { calls, adapter };
  };
  test("outside dev: assign, then In Progress, through the runner, then the agent", async () => {
    setSuggestionsForTest([s("ABC-5")]);
    const f = fake();
    setAdapter(f.adapter, false);
    const started: string[] = [];
    await pickupSuggestion("ABC-5", "widgets", { start: async (k, r) => started.push(`${k}@${r}`), agent: async () => null, refresh: () => {} });
    expect(f.calls.map((c) => c.slice(2))).toEqual([["assign", "ABC-5", "me"], ["transition", "ABC-5", "In Progress"]]);
    expect(started).toEqual(["ABC-5@widgets"]);
    const rows = db.query<{ action: string; result: string; dry_run: number }, []>("SELECT action, result, dry_run FROM action_records WHERE work_item = 'ABC-5' ORDER BY id").all();
    expect(rows).toEqual([{ action: "jira-assign", result: "assigned", dry_run: 0 }, { action: "jira-transition", result: "moved", dry_run: 0 }]);
  });
  test("in dev: records dry runs and runs no command", async () => {
    setSuggestionsForTest([s("ABC-6")]);
    const f = fake();
    setAdapter(f.adapter, true);
    await pickupSuggestion("ABC-6", "widgets", { start: async () => null, agent: async () => null, refresh: () => {} });
    expect(f.calls).toEqual([]);
    const rows = db.query<{ result: string }, []>("SELECT result FROM action_records WHERE work_item = 'ABC-6' ORDER BY id").all();
    expect(rows.map((r) => r.result)).toEqual(["dry run", "dry run"]);
  });
});


test("factsOf finds a board item that shares the suggestion's parent", () => {
  const item = { key: "ABC-100", prs: [], jira: { status: "In Progress", url: "", summary: "", suggest: null, parent: { key: "ABC-1", summary: "Feature" } } } as unknown as WorkItem;
  const other = { key: "ABC-200", prs: [], jira: { status: "In Progress", url: "", summary: "", suggest: null, parent: { key: "ABC-9", summary: "Other" } } } as unknown as WorkItem;
  const f = factsOf({ key: "ABC-300", parent: { key: "ABC-1", summary: "Feature" }, links: [] }, [item, other]);
  expect(f.board).toEqual(["ABC-100"]);
});

test("pickup leaves out the steps the Start box unticked", async () => {
  const seen: string[][] = [];
  setAdapter(async (cmd) => { seen.push(cmd); return { out: "{}", err: "", code: 0 }; }, false);
  setSuggestionsForTest([{ key: "ABC-42", summary: "x", status: "To Do", priority: "Medium", assignee: null, labels: [], parent: null, links: [], updated: null, rank: 0, url: null, source: "a" } as never]);
  let started = false;
  await pickupSuggestion("ABC-42", "widgets", { start: async () => { started = true; return {}; }, agent: async () => ({}), refresh: () => {} }, { assign: false, move: false });
  expect(seen.length).toBe(0);
  expect(started).toBe(true);
  setAdapter(null);
});

describe("a pickup leaves the list and becomes a work item", () => {
  const raw = (key: string, assignee: "me" | null = null) => ({ key, summary: `sum ${key}`, status: "To Do", priority: "Medium", assignee, labels: [], parent: null, links: [], updated: null, rank: 0, url: `https://x/browse/${key}`, source: "a" }) as never;
  const deps = { start: async () => ({}), agent: async () => ({}), refresh: () => {} };
  test("Move without Assign is refused, and so is a pickup with no step", async () => {
    setSuggestionsForTest([raw("ABC-50")]);
    setAdapter(async () => ({ out: "{}", err: "", code: 0 }), true);
    await expect(pickupSuggestion("ABC-50", "widgets", deps, { assign: false, move: true, agent: true })).rejects.toThrow("Move to In Progress needs Assign");
    await expect(pickupSuggestion("ABC-50", "widgets", deps, { assign: false, move: false, agent: false })).rejects.toThrow("at least one step");
    expect(suggestionsView().suggestions.map((x) => x.key)).toEqual(["ABC-50"]);
  });
  test("assign only, in dev: off the list, and a My turn item 'Picked up, not started'", async () => {
    setSuggestionsForTest([raw("ABC-51")]);
    setAdapter(async () => ({ out: "{}", err: "", code: 0 }), true);
    await pickupSuggestion("ABC-51", "widgets", deps, { assign: true, move: false, agent: false });
    expect(suggestionsView().suggestions.map((x) => x.key)).not.toContain("ABC-51");
    const it = applyPicked([], pickedNow(), new Map()).find((x) => x.key === "ABC-51")!;
    expect([it.key, it.lane, it.why]).toEqual(["ABC-51", "mine", "Picked up, not started"]);
    expect(applyPicked([{ ...it, why: "other" }], pickedNow(), new Map()).filter((x) => x.key === "ABC-51")).toHaveLength(1);
  });
  test("a pickup holds until the issue is back in To Do unassigned after 14 days", () => {
    const at = "2026-10-01T00:00:00Z";
    const p = { "ABC-52": { at, summary: "", url: null } };
    const day = 86_400_000;
    expect(isPicked({ key: "ABC-52", assignee: null }, p, Date.parse(at) + 13 * day)).toBe(true);
    expect(isPicked({ key: "ABC-52", assignee: "me" }, p, Date.parse(at) + 30 * day)).toBe(true);
    expect(isPicked({ key: "ABC-52", assignee: null }, p, Date.parse(at) + 14 * day)).toBe(false);
    expect(livePicked([{ key: "ABC-52", assignee: null }], p, Date.parse(at) + 14 * day)).toEqual({});
  });
});
