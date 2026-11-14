import { expect, test } from "bun:test";
import { digestOf } from "./digest";
import { enrich, prBrief } from "./friction";
import type { PrFacts } from "./metrics";
import { tiesTo } from "./usage";

const l = (o: object) => JSON.stringify(o);
const transcript = [
  l({ type: "user", timestamp: "t1", message: { content: "any other feedback on the PR?" } }),
  l({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
  l({ type: "user", message: { content: "<task-notification>agent done</task-notification>" } }),
  l({ type: "system", subtype: "compact_boundary" }),
  l({ type: "user", isCompactSummary: true, message: { content: "This session is being continued from a previous conversation" } }),
  l({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [External System Writes]. If" }] } }),
  l({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: [{ type: "text", text: "The user doesn't want to proceed with this tool use." }] }] } }),
  l({ type: "user", message: { content: [{ type: "tool_result", is_error: false, content: "ok" }] } }),
  "not json",
].join("\n");

test("a digest keeps typed turns and counts refusals by reason, compactions and clears", () => {
  const d = digestOf(transcript);
  expect(d.turns).toEqual([{ at: "t1", text: "any other feedback on the PR?" }]);
  expect(d.denials).toEqual({ "External System Writes": 1, "user rejected": 1 });
  expect(d.compactions).toBe(1);
  expect(d.clears).toBe(1);
});

test("an agent is tied to an item only when its repo is one of the item's", () => {
  expect(tiesTo({ repos: ["shop_web"] }, "control-room")).toBe(false);
  expect(tiesTo({ repos: ["shop_web"] }, "shop_web")).toBe(true);
  expect(tiesTo({ repos: ["x"] }, null)).toBe(true);
});

test("each item in the index carries its PR steps, review runs and sessions' digests", () => {
  const f = { ref: "o/r#1", title: "t", feature: "K-1", created: "c", ready: "r", merged: "m", closed: null, feedback: [{ at: "", who: "", bot: false, kind: "thread" }], rounds: 2, commits: [], reviews: [{ who: "sam", at: "a", state: "APPROVED" }] } as unknown as PrFacts;
  const items = enrich([{ item: "K-1", repos: ["r"], board: [], sessions: [{ session: "s1", repo: "r", from: "", to: "", turns: 3, transcript: null }] }],
    [f], (ref) => (ref === "o/r#1" ? { sha: "abc", posted: { at: "p", event: "APPROVE" } } : null),
    new Map([["s1", digestOf(transcript)]]), new Map([["s1", "review: started in a cleared session"]]));
  expect(items[0].prs).toEqual([prBrief(f)]);
  expect(items[0].prs![0]).toMatchObject({ opened: "c", ready: "r", merged: "m", feedback: 1, rounds: 2 });
  expect(items[0].reviewRuns).toEqual([{ ref: "o/r#1", sha: "abc", posted: "p", event: "APPROVE" }]);
  expect(items[0].sessions[0]).toMatchObject({ startedBy: "review: started in a cleared session", typed: 1, compactions: 1, clears: 1 });
});
