import { describe, expect, test } from "bun:test";
import type { Agent, Feedback, PrRow } from "../shared/types";
import { decide } from "./notify";
import { applyParks, groupWorkItems } from "./workitems";

const BASE = "http://127.0.0.1:4777/";
let n = 500;
function pr(over: Partial<PrRow>): PrRow {
  n++;
  return {
    repo: "acme/widgets", number: n, title: `ABC-${n}: a change`, url: `https://example.test/pull/${n}`, author: "me", draft: false,
    updated: "2030-01-01T00:00:00Z", checks: "success", pending_reviewers: ["pat"], branch: `b-${n}`, base: "main", head: "h1", id: `PR_${n}`,
    merge_state: "BLOCKED", can_merge: "needs approval", review_decision: "REVIEW_REQUIRED", last_activity: "2030-01-01T00:00:00Z",
    role: "mine", state: "waiting", feedback: [], rerequest: [], mark: null, superseded: null, ...over,
  };
}
const fb = (over: Partial<Feedback>): Feedback => ({ kind: "thread", who: "pat", bot: false, url: `https://example.test/c/${++n}`, at: "2030-01-02T00:00:00Z", body: "x", ...over });
const agent = (over: Partial<Agent>): Agent => ({
  pane: `w1:p${++n}`, tab: "w1:t1", workspace: "w1", name: "bot-1", label: "spike", title: "", workspaceLabel: "ws", status: "working",
  cwd: "/tmp", repo: null, branch: null, session: null, focused: false, seq: 1, finishedSeq: null, ...over,
});

const run = (rows: PrRow[], agents: Agent[], seen: Set<string> | null) => decide(groupWorkItems(rows, agents), seen, BASE);

describe("notifications", () => {
  test("first run sends one summary and remembers everything", () => {
    const rows = [pr({ checks: "failure" }), pr({ role: "requested", author: "pat", direct: true })];
    const r = run(rows, [], null);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].body).toBe("1 in My turn, 1 asked of you");
    expect(run(rows, [], r.seen).notes).toHaveLength(0);
  });

  test("CI failing notifies once, quietly, titled by the key", () => {
    const quiet = run([pr({})], [], null).seen;
    const failing = pr({ checks: "failure" });
    const r = run([failing], [], quiet);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ loud: false, body: `CI failed on #${failing.number}` });
    expect(r.notes[0].title).toStartWith(`ABC-${failing.number} · `);
    expect(run([failing], [], r.seen).notes).toHaveLength(0);
    // A new head that fails again is a new failure.
    expect(run([{ ...failing, head: "h2" }], [], r.seen).notes).toHaveLength(1);
  });

  test("changes requested and an agent waiting are loud", () => {
    const r1 = run([pr({ state: "address", feedback: [fb({ kind: "changes" })] })], [], new Set());
    expect(r1.notes[0].loud).toBe(true);
    const r2 = run([], [agent({ status: "blocked" })], new Set());
    expect(r2.notes[0]).toMatchObject({ loud: true, body: "agent bot-1 is waiting on you" });
  });

  test("bot feedback alone stays quiet, then rides along with the next notification", () => {
    const p = pr({ state: "address", feedback: [fb({ who: "coderabbitai", bot: true })] });
    const r1 = run([p], [], new Set());
    expect(r1.notes).toHaveLength(0);
    const r2 = run([{ ...p, checks: "failure" }], [], r1.seen);
    expect(r2.notes).toHaveLength(1);
    expect(r2.notes[0].body).toContain("coderabbitai commented");
    expect(r2.notes[0].body).toContain("CI failed");
  });

  test("an agent finishing notifies even when herdr counted it seen and the item waits on CI", () => {
    const rows = [pr({ checks: "pending", branch: "fix/x" })];
    const working = agent({ status: "working", repo: "widgets", branch: "fix/x", seq: 5 });
    const r1 = run(rows, [working], new Set());
    expect(r1.notes).toHaveLength(0);
    const finished = { ...working, status: "idle" as const, seq: 6, finishedSeq: 6 };
    const r2 = run(rows, [finished], r1.seen);
    expect(r2.notes).toHaveLength(1);
    expect(r2.notes[0].body).toBe("agent bot-1 finished");
    // herdr later marking it seen (done → idle) is not a second finish.
    expect(run(rows, [{ ...finished, seq: 7 }], r2.seen).notes).toHaveLength(0);
  });

  test("waiting on the author: Waiting on others, then back with a loud note when they push or comment", () => {
    const p = pr({ role: "requested", author: "pat", direct: true, head: "h1", others_activity: "2030-01-01T00:00:00Z" });
    const hold = { ref: `${p.repo}#${p.number}`, setAt: "2030-01-01T01:00:00Z", head: "h1", since: "2030-01-01T00:00:00Z", note: "open thread" };
    const holds = new Map([[hold.ref, hold]]);
    const seen = decide(groupWorkItems([p], []), null, BASE).seen;
    const [held] = groupWorkItems([p], [], holds);
    expect(held.lane).toBe("waiting");
    expect(held.why).toBe("waiting on pat: open thread");
    expect(decide([held], seen, BASE).notes).toHaveLength(0);
    // Pat's own comment doesn't wake it: others_activity ignores him.
    for (const next of [{ ...p, head: "h2" }, { ...p, others_activity: "2030-01-01T02:00:00Z" }]) {
      const [woke] = groupWorkItems([next], [], holds);
      expect(woke.lane).toBe("asked");
      const r = decide([woke], seen, BASE);
      expect(r.notes).toHaveLength(1);
      expect(r.notes[0].loud).toBe(true);
      expect(r.notes[0].body).toContain("since you started waiting");
    }
  });

  test("parked: out of the lanes and silent, back with a notification on its timer or a person's feedback", () => {
    const p = pr({ checks: "failure", title: "ABC-900: parked one" });
    const park = { item: "abc-900", setAt: "2030-01-01T00:00:00Z", until: "2030-01-02T09:00:00Z", note: "after the release" };
    const parks = new Map([[park.item, park]]);
    const before = Date.parse("2030-01-01T12:00:00Z");
    const [held] = applyParks(groupWorkItems([p], [agent({ status: "working", branch: p.branch, repo: "widgets" })]), parks, before);
    expect(held.lane).toBe("parked");
    expect(decide([held], new Set(), BASE).notes).toHaveLength(0);
    // Bot feedback doesn't wake it; a person's does.
    const bot = { ...p, state: "address" as const, feedback: [fb({ bot: true, who: "coderabbitai", at: "2030-01-01T06:00:00Z" })] };
    expect(applyParks(groupWorkItems([bot]), parks, before)[0].lane).toBe("parked");
    const human = { ...p, state: "address" as const, feedback: [fb({ who: "pat", at: "2030-01-01T06:00:00Z" })] };
    const [woken] = applyParks(groupWorkItems([human]), parks, before);
    expect(woken.lane).toBe("mine");
    expect(decide([woken], new Set(), BASE).notes[0].body).toContain("back from parked: pat commented");
    // An agent waiting for input wakes it into My turn, with its question as the why.
    const [asked] = applyParks(groupWorkItems([p], [agent({ status: "blocked", title: "Which table?", branch: p.branch, repo: "widgets" })]), parks, before);
    expect(asked.lane).toBe("mine");
    expect(asked.park?.woke).toContain("asks: “Which table?”");
    expect(asked.why).toContain("Which table?");
    // CI and a push (new checks, a new head) still never wake it.
    const pushed = { ...p, checks: "success" as const, head: "def456" };
    expect(applyParks(groupWorkItems([pushed], [agent({ status: "working", branch: p.branch, repo: "widgets" })]), parks, before)[0].lane).toBe("parked");
    // The timer.
    const [timed] = applyParks(groupWorkItems([p]), parks, Date.parse("2030-01-02T09:00:01Z"));
    expect(timed.park?.woke).toBe("timer's up");
  });

  test("Waiting on others never notifies", () => {
    expect(run([pr({}), pr({ draft: true, state: "draft" })], [agent({ status: "working" })], new Set()).notes).toHaveLength(0);
  });

  test("at most three per poll, the rest folded into one", () => {
    const rows = [1, 2, 3, 4, 5].map(() => pr({ checks: "failure" }));
    const r = run(rows, [], new Set());
    expect(r.notes).toHaveLength(4);
    expect(r.notes[3].body).toBe("+2 more in My turn");
    expect(run(rows, [], r.seen).notes).toHaveLength(0);
  });

  test("a click opens the work item", () => {
    const r = run([pr({ checks: "failure", title: "ABC-77: x" })], [], new Set());
    expect(r.notes[0].url).toBe(`${BASE}item/abc-77`);
  });
});
