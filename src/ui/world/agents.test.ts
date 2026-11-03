import { describe, expect, test } from "bun:test";
import type { Agent, AgentTask, PrRow, WorkItem } from "../../shared/types";
import { givers, place, stepOf, townsfolk } from "./agents";
import { SEATS, SPOTS } from "./map";

const pr = (over: Partial<PrRow> = {}) => ({ repo: "acme/widgets", number: 7, branch: "abc-1", draft: false, merge_state: "CLEAN", checks: "success", state: "waiting", feedback: [], pending_reviewers: [], review_decision: null, ...over }) as PrRow;
const agent = (over: Partial<Agent> = {}) => ({ pane: "w1:p1", label: "ABC-1 fix", name: null, status: "working", branch: "abc-1", ...over }) as Agent;
const item = (over: Partial<WorkItem> = {}) => ({ id: "abc-1", key: "ABC-1", title: "a change", why: "", lane: "mine", urgency: 1, prs: [pr()], agents: [agent()], ...over }) as WorkItem;

describe("stepOf", () => {
  const at = (it: Partial<WorkItem>, task: AgentTask = "build") => stepOf(task, item(it), "abc-1");
  test("the agent's task decides first", () => {
    expect(at({}, "selfreview").skill).toBe("fishing");
    expect(at({}, "verify").skill).toBe("mining");
    expect(at({}, "chart").skill).toBe("woodcutting");
    expect(at({}, "grill")).toEqual({ skill: "cooking", detail: "grilling a plan for ABC-1" });
  });
  test("improving work builds at the Construction site, named for what it improves", () => {
    expect(at({ id: "loop-2030-W01" }, "improve")).toEqual({ skill: "construction", detail: "improving the weekly self-improvement loop" });
    expect(at({ id: "arch-widgets" }, "improve").detail).toBe("improving the codebase's architecture");
  });
  test("the task the server set wins over the label's verb", () => {
    const [a] = townsfolk([item({ agents: [agent({ label: "ABC-1 fix", task: "grill" })] })]);
    expect([a.skill, a.kind]).toEqual(["cooking", "helper"]);
  });
  test("then the PR's state", () => {
    expect(at({ prs: [] })).toEqual({ skill: "smithing", detail: "building the change, no PR yet" });
    expect(at({ prs: [pr({ merge_state: "DIRTY" })] })).toEqual({ skill: "crafting", detail: "resolving conflicts on #7" });
    expect(at({ prs: [pr({ checks: "failure" })] })).toEqual({ skill: "crafting", detail: "fixing CI on #7" });
    expect(at({ prs: [pr({ checks: "pending" })] }).skill).toBe("mining");
    expect(at({ prs: [pr({ feedback: [{}, {}] as PrRow["feedback"] })] })).toEqual({ skill: "crafting", detail: "addressing 2 review threads on #7" });
    expect(at({ stopChecks: [{ running: true }] as WorkItem["stopChecks"] }).detail).toBe("running the local checks");
  });
  test("a fix agent crafts, whatever state its PR is in", () => {
    expect(at({}, "fix")).toEqual({ skill: "crafting", detail: "fixing #7" });
    expect(at({ prs: [pr({ checks: "pending" })] }, "fix").skill).toBe("crafting");
  });
  test("the PR on the agent's own branch", () => {
    expect(stepOf("fix", item({ prs: [pr({ number: 1, branch: "other" }), pr({ number: 2, checks: "failure" })] }), "abc-1").detail).toBe("fixing CI on #2");
  });
});

describe("place", () => {
  const folk = (n: number, status = "working", label = "agent ABC-1") => townsfolk([item({ agents: Array.from({ length: n }, (_, i) => agent({ pane: `p${String(i).padStart(2, "0")}`, status: status as Agent["status"], label })) })]);
  test("working agents go to their step's spots, then the next skill with room", () => {
    const p = place(folk(5));
    expect(p.slice(0, 3).map((x) => x.skill)).toEqual(["smithing", "smithing", "smithing"]);
    expect(p[3].skill).not.toBe("smithing");
    expect(new Set(p.map((x) => `${x.s.x},${x.s.z}`)).size).toBe(5);
  });
  test("idle and finished agents take seats in the Inn; ones waiting on you, the square", () => {
    expect(place(folk(2, "idle")).map((x) => [x.mode, x.s.area])).toEqual([["drink", "Inn"], ["drink", "Inn"]]);
    expect(place(folk(1, "blocked"))[0]).toMatchObject({ mode: "ask", s: { area: "Square" } });
  });
  test("a full Inn still seats everyone, somewhere new", () => {
    const p = place(folk(SEATS.length + 2, "done"));
    expect(new Set(p.map((x) => `${x.s.x},${x.s.z}`)).size).toBe(SEATS.length + 2);
  });
  test("more workers than spots: the rest wait in the Inn", () => {
    const all = Object.values(SPOTS).flat().length;
    expect(place(folk(all + 1)).at(-1)?.mode).toBe("drink");
  });
});

describe("fights", () => {
  const two = (reviewer: Partial<Agent>, others: WorkItem[] = []) => place(townsfolk([item({ agents: [agent({ pane: "p1", label: "ABC-1 fix", status: "idle" }), agent({ pane: "p2", ...reviewer })] }), ...others]));
  test("a self-review fights its PR's own session in the Wilderness, whatever either is doing", () => {
    const p = two({ label: "selfreview widgets#7", status: "working" });
    expect(p.map((x) => [x.a.pane, x.mode, x.role, x.foe, x.s.area])).toEqual([["p1", "fight", "attack", "p2", "Wilderness"], ["p2", "fight", "defend", "p1", "Wilderness"]]);
    // They face each other.
    expect(p[0].s.at).toEqual([p[1].s.x, p[1].s.z]);
  });
  test("other helpers don't fight, and a self-review with no owner on its item doesn't either", () => {
    expect(two({ label: "verify ABC-1" }).map((x) => x.mode)).not.toContain("fight");
    expect(place(townsfolk([item({ agents: [agent({ pane: "p2", label: "selfreview widgets#7" })] })])).map((x) => x.mode)).toEqual(["skill"]);
  });
  test("by the herdr name too: what fights is the label's kind, not the name shown", () => {
    expect(two({ label: "selfreview widgets#7", name: "cr-widgets-7" }).map((x) => x.mode)).toEqual(["fight", "fight"]);
  });
});

describe("prayer", () => {
  const waiting = pr({ pending_reviewers: ["@sam"], review_decision: null, state: "waiting" });
  test("an agent not working, whose PR waits on someone's review, prays in the Chapel", () => {
    const [p] = place(townsfolk([item({ prs: [waiting], agents: [agent({ status: "idle" })] })]));
    expect([p.mode, p.s.area, p.a.awaiting]).toEqual(["pray", "Chapel", "sam"]);
  });
  test("not while it works, nor once there's feedback to answer or an approval", () => {
    expect(place(townsfolk([item({ prs: [waiting], agents: [agent({ status: "working" })] })]))[0].mode).toBe("skill");
    expect(place(townsfolk([item({ prs: [{ ...waiting, feedback: [{}] as PrRow["feedback"] }], agents: [agent({ status: "idle" })] })]))[0].mode).toBe("drink");
    expect(place(townsfolk([item({ prs: [{ ...waiting, review_decision: "APPROVED" }], agents: [agent({ status: "idle" })] })]))[0].mode).toBe("drink");
  });
});

describe("firemaking", () => {
  const spent = { reason: "your review is posted", output: null, since: "2030-01-01T00:00:00Z", closesAt: null };
  test("a spent agent burns its logs at the Bonfire, ahead of praying", () => {
    const [p] = place(townsfolk([item({ prs: [pr({ pending_reviewers: ["@sam"], review_decision: null, state: "waiting" })], agents: [agent({ status: "idle", spent })] })]));
    expect([p.mode, p.s.area, p.a.spent]).toEqual(["burn", "Bonfire", "your review is posted"]);
  });
  test("not while it works", () => {
    expect(place(townsfolk([item({ agents: [agent({ status: "working", spent })] })]))[0].mode).toBe("skill");
  });
});

describe("givers", () => {
  test("only items that need the user, nearer the fountain when more pressing", () => {
    const g = givers([item({ id: "a", lane: "mine", urgency: 3 }), item({ id: "b", lane: "asked", urgency: 1 }), item({ id: "c", lane: "waiting" })]);
    expect(g.map((x) => x.id)).toEqual(["a", "b"]);
    const d = (x: { x: number; z: number }) => Math.hypot(x.x - 24, x.z - 20);
    expect(d(g[0])).toBeLessThan(d(g[1]));
  });
  test("not an item that's only waiting because of its agents: the agent shows that", () => {
    const g = givers([
      item({ id: "a", why: "agent cr-a finished" }),
      item({ id: "b", why: "agent cr-b is waiting on you · agent cr-c finished" }),
      item({ id: "c", why: "agent cr-d finished · 2 unanswered on widgets#7" }),
    ]);
    expect(g.map((x) => x.id)).toEqual(["c"]);
  });
});
