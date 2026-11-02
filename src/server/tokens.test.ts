import { describe, expect, test } from "bun:test";
import { sum, tally, turnOf, usd, weighted, type Turn } from "./tokens";

const line = (over: object = {}, usage: object = {}) => JSON.stringify({
  type: "assistant", timestamp: "2030-01-08T10:00:00Z", sessionId: "s1", cwd: "/tmp/widgets", gitBranch: "abc-1-thing",
  message: { id: "msg_1", model: "claude-test", usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_1h_input_tokens: 200 }, ...usage } },
  ...over,
});

describe("turnOf", () => {
  test("a model response with usage, cache writes split by lifetime", () => {
    expect(turnOf(line())).toEqual({ id: "msg_1", at: "2030-01-08T10:00:00Z", session: "s1", model: "claude-test", dir: "/tmp/widgets", branch: "abc-1-thing",
      input: 10, output: 100, read: 1000, write5m: 100, write1h: 200 });
  });
  test("anything else is skipped", () => {
    expect(turnOf(JSON.stringify({ type: "user", message: { content: "hi" } }))).toBeNull();
    expect(turnOf(line({ message: { id: "m", model: "<synthetic>", usage: {} } }))).toBeNull();
    expect(turnOf("not json \"usage\"")).toBeNull();
  });
});

describe("tally", () => {
  const t = (over: Partial<Turn>): Turn => ({ id: "x", at: "2030-01-08T10:00:00Z", session: "s1", model: "m", dir: "/d", branch: "b",
    input: 0, output: 0, read: 0, write5m: 0, write1h: 0, ...over });
  test("price-weighted tokens: output counts 5, a cache read a tenth", () => {
    expect(weighted(t({ input: 10, output: 10, read: 100, write5m: 4, write1h: 5 }))).toBe(10 + 50 + 10 + 5 + 10);
  });
  test("sums per work item and week, with electricity and water from the coefficients", () => {
    const turns = [t({ output: 200_000, session: "a" }), t({ output: 200_000, session: "b" }), t({ input: 1_000_000, branch: "other", at: "2030-01-15T10:00:00Z" })];
    const r = tally(turns, (x) => ({ key: x.branch === "b" ? "ABC-1" : "ABC-2", repo: "widgets" }), { whPerMTok: 200, litersPerKwh: 2 });
    expect(r.items.map((i) => [i.key, i.weighted, i.sessions])).toEqual([["ABC-1", 2_000_000, 2], ["ABC-2", 1_000_000, 1]]);
    expect(r.items[0].kwh).toBeCloseTo(0.4);
    expect(r.items[0].liters).toBeCloseTo(0.8);
    expect(r.weeks.map((w) => [w.week, w.weighted])).toEqual([["2030-01-07", 2_000_000], ["2030-01-14", 1_000_000]]);
    expect(sum(r.items).weighted).toBe(3_000_000);
  });
  test("API cost by the turn's model; an unknown model is priced as Opus 5.5", () => {
    const m = { input: 1e6, output: 1e6, read: 1e6, write5m: 1e6, write1h: 1e6 };
    expect(usd(t({ ...m, model: "claude-opus-5-5" }))).toBeCloseTo(4 + 20 + 0.2 + 5 + 8);
    expect(usd(t({ ...m, model: "claude-haiku-4-5-20251001" }))).toBeCloseTo(1 + 5 + 0.1 + 1.25 + 2);
    expect(usd(t({ output: 1e6, model: "claude-someday-9" }))).toBeCloseTo(20);
  });
  test("sessions outside a repo count their tokens but not as sessions", () => {
    const r = tally([t({ output: 10, session: "a" }), t({ output: 10, session: "bg" })], (x) => ({ key: "K", repo: x.session === "bg" ? null : "widgets" }), { whPerMTok: 1, litersPerKwh: 1 });
    expect(r.weeks[0]).toMatchObject({ weighted: 100, sessions: 1 });
  });
});
