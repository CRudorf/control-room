import { describe, expect, test } from "bun:test";
import type { Agent, WorkItem } from "../shared/types";
import { boardText, paneTokens, statusLine } from "./panemeta";
import { render } from "./board";

const agent = (pane: string, status: Agent["status"] = "working") => ({ pane, status } as Agent);
const item = (over: Partial<WorkItem>) => ({
  id: over.key ?? "x", key: "ABC-1", keyKind: "jira", title: "a change", lane: "mine", why: "feedback to address", agents: [], prs: [], ...over,
} as WorkItem);

describe("pane tokens", () => {
  test("each agent pane carries its item, whose turn it is, and its place in Next", () => {
    const t = paneTokens([
      item({ key: "ABC-1", lane: "mine", agents: [agent("w1:p1"), agent("w1:p2")], next: { rank: 2 } as WorkItem["next"] }),
      item({ key: "ABC-2", lane: "waiting", agents: [agent("w1:p3")] }),
      item({ key: "ABC-3", lane: "asked" }),
    ]);
    expect(t.get("w1:p1")).toEqual({ item: "ABC-1", ball: "my turn", next: "next 2" });
    expect(t.get("w1:p2")).toEqual(t.get("w1:p1")!);
    expect(t.get("w1:p3")).toEqual({ item: "ABC-2", ball: "waiting", next: null });
    expect(t.size).toBe(3);
  });

  test("an agent that is its own work item gets no item token, and long keys are cut", () => {
    const t = paneTokens([
      item({ key: "my tab label", keyKind: "agent", agents: [agent("p1")] }),
      item({ key: "a-very-long-branch-name-that-goes-on", keyKind: "branch", agents: [agent("p2")] }),
    ]);
    expect(t.get("p1")!.item).toBeNull();
    expect(t.get("p2")!.item).toBe("a-very-long-branch-name…");
  });
});

describe("status line", () => {
  test("counts the three lanes, parked left out", () => {
    const s = statusLine([
      item({ key: "ABC-1", lane: "mine" }),
      item({ key: "ABC-2", lane: "mine" }),
      item({ key: "ABC-3", lane: "asked" }),
      item({ key: "ABC-4", lane: "waiting" }),
      item({ key: "ABC-5", lane: "parked" }),
    ]);
    expect(s).toBe("my turn 2 · waiting on others 1 · asked of me 1");
  });

  test("an empty board still shows every lane", () => {
    expect(statusLine([])).toBe("my turn 0 · waiting on others 0 · asked of me 0");
  });
});

describe("board text", () => {
  test("lanes in board order, empty lanes left out, agents' states as letters", () => {
    const t = boardText([
      item({ key: "ABC-2", lane: "waiting", title: "two", why: "CI running", agents: [agent("p1", "working"), agent("p2", "blocked")] }),
      item({ key: "ABC-1", lane: "mine", title: "one", why: "approved", next: { rank: 1 } as WorkItem["next"] }),
    ], new Date(2030, 0, 7, 9, 5));
    expect(t).toBe([
      "control room · as of 09:05", "",
      "MY TURN 1", " 1 ABC-1  one", "     approved", "",
      "WAITING ON OTHERS 1", " · ABC-2 [wb]  two", "     CI running", "",
    ].join("\n"));
  });

  test("parked shows five and counts the rest", () => {
    const t = boardText(Array.from({ length: 7 }, (_, i) => item({ key: `P-${i}`, lane: "parked" })), new Date());
    expect(t).toContain("PARKED 7");
    expect(t).toContain("P-4");
    expect(t).not.toContain("P-5");
    expect(t).toContain("+2 more");
  });

  test("the pane cuts lines to its width", () => {
    const out = render("control room\n\nMY TURN 1\n 1 ABC-1  a very long title indeed\n", 12).replace(/\x1b\[\d+m/g, "");
    expect(out.split("\n")[3]).toBe(" 1 ABC-1  a…");
  });
});
