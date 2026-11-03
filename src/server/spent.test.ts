import { describe, expect, test } from "bun:test";
import { doneLine, spentOf, type SpentFacts } from "./spent";

const NOW = Date.parse("2030-01-03T00:00:00Z");
const pr = { repo: "acme/widgets", number: 7, branch: "abc-1", url: "https://github.com/acme/widgets/pull/7" };
const facts = (over: Partial<SpentFacts> & { task?: SpentFacts["a"]["task"]; status?: string } = {}): SpentFacts => ({
  a: { pane: "p1", name: "cr-widgets-7", label: "x", status: (over.status ?? "idle") as never, branch: "abc-1", since: "2030-01-02T23:00:00Z", task: over.task ?? "build" },
  it: { keyKind: "jira", lane: "waiting", prs: [pr] } as never, done: undefined, startedAt: "2030-01-02T00:00:00Z", charts: [], runs: [], ended: new Map(), now: NOW, ...over,
});

describe("spentOf", () => {
  test("never while it works or waits on the user", () => {
    expect(spentOf(facts({ status: "working", done: "x" }))).toBeNull();
    expect(spentOf(facts({ status: "blocked", done: "x" }))).toBeNull();
  });
  test("a DONE line ends any task; exact for helpers, a click for builders", () => {
    expect(spentOf(facts({ task: "chart", done: "https://x/chart" }))).toEqual({ reason: "said it's done", output: "https://x/chart", exact: true });
    expect(spentOf(facts({ task: "build", done: "" }))?.exact).toBe(false);
  });
  test("a review: once posted, or once the request is gone", () => {
    expect(spentOf(facts({ task: "review", it: { keyKind: "review", lane: "asked", prs: [pr] } as never }))).toBeNull();
    expect(spentOf(facts({ task: "review", it: { keyKind: "review", lane: "waiting", prs: [pr] } as never }))?.reason).toBe("your review is posted");
    expect(spentOf(facts({ task: "review", it: null }))?.reason).toBe("its review request is gone");
  });
  test("a chart: once one is made for its PR after it started", () => {
    const old = { pr: "acme/widgets#7", createdAt: "2030-01-01T00:00:00Z", url: "u-old" }, fresh = { ...old, createdAt: "2030-01-02T12:00:00Z", url: "u-new" };
    expect(spentOf(facts({ task: "chart", charts: [old] }))).toBeNull();
    expect(spentOf(facts({ task: "chart", charts: [old, fresh] }))?.output).toBe("u-new");
  });
  test("a verification: once its run has every result", () => {
    expect(spentOf(facts({ task: "verify", runs: [{ agent: "cr-widgets-7", reported: false, url: "r" }] }))).toBeNull();
    expect(spentOf(facts({ task: "verify", runs: [{ agent: "cr-widgets-7", reported: true, url: "r" }] }))?.reason).toBe("the run has its results");
  });
  test("a builder: once its PR merged or closed, as a question", () => {
    expect(spentOf(facts({ it: { keyKind: "agent", lane: "waiting", prs: [] } as never, ended: new Map([["abc-1", "merged"]]) }))).toEqual({ reason: "its PR merged", output: null, exact: false });
    expect(spentOf(facts({ ended: new Map([["abc-1", "merged"]]) }))).toBeNull();
  });
  test("idle a day with nothing open: worth asking", () => {
    expect(spentOf(facts({ it: null, a: { pane: "p", name: null, label: "x", status: "idle", branch: null, since: "2030-01-01T00:00:00Z", task: "grill" } }))?.reason).toBe("idle a day with no open PR");
  });
});

describe("doneLine", () => {
  test("the line's link or path; empty without one; undefined without the line", () => {
    expect(doneLine("All set.\nDONE: https://x/y")).toBe("https://x/y");
    expect(doneLine("DONE: `~/handoffs/a.md`")).toBe("~/handoffs/a.md");
    expect(doneLine("DONE:")).toBe("");
    expect(doneLine("not done")).toBeUndefined();
  });
});
