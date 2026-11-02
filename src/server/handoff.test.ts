import { expect, test } from "bun:test";
import { planStart } from "./handoff";

const a = (label: string, status = "idle", name = label) => ({ pane: `p-${name}`, label, name, status });
const owner = { item: "abc-6787", pr: null, kind: "custom" as const };
const onPr = { item: "abc-6787", pr: "o/widgets#3792", kind: "custom" as const };
const chart = { ...onPr, verb: "chart" };

test("a second start on an item goes to its free session and keeps context", () => {
  expect(planStart(owner, [a("agent ABC-6787")])).toEqual({ reuse: { pane: "p-agent ABC-6787", fresh: false } });
  expect(planStart(onPr, [a("agent widgets#3792")])).toEqual({ reuse: { pane: "p-agent widgets#3792", fresh: false } });
});
test("a start is refused while the working session is busy, and names it", () => {
  expect(planStart(owner, [a("agent ABC-6787", "working", "cr-x")])).toEqual({ refuse: "cr-x is working on this. Wait for it, or send it a message." });
});
test("helpers share one session, cleared, and never take the working session", () => {
  expect(planStart(chart, [a("agent ABC-6787")])).toEqual({ open: true });
  expect(planStart(chart, [a("verify widgets#3792")])).toEqual({ reuse: { pane: "p-verify widgets#3792", fresh: true } });
  expect("refuse" in planStart(chart, [a("chart widgets#3792", "working")])).toBe(true);
  expect(planStart({ ...onPr, kind: "selfreview" }, [a("chart widgets#3792")])).toEqual({ reuse: { pane: "p-chart widgets#3792", fresh: true } });
  expect(planStart(onPr, [a("verify widgets#3792")])).toEqual({ open: true });
});
test("another item's session does not count, and only New tab forces a second", () => {
  expect(planStart(owner, [a("agent ABC-67870"), a("agent widgets#37920")])).toEqual({ open: true });
  expect(planStart({ ...owner, newSession: true }, [a("agent ABC-6787")])).toEqual({ open: true });
});
