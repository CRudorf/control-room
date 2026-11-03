import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import type { PrRow } from "../shared/types";
import { dismissFinding, draftsFile, pendingDrafts, readDrafts, reviewPrompt } from "./review";

const ref = "o/widgets#4242";
const findings = [
  { path: "src/a.ts", line: 3, rank: "nit", title: "rename the flag", body: "call it on" },
  { path: "src/b.ts", line: 9, rank: "important", title: "off by one", body: "loop stops early" },
];
const write = () => writeFileSync(draftsFile(ref), JSON.stringify({ pr: ref, sha: "abc1234", findings }));

test("a dismissed finding keeps its reason, leaves the count, and survives a rewrite of the drafts", () => {
  write();
  expect(pendingDrafts().get(ref)).toBe(2);
  const nit = readDrafts(ref)!.findings.find((f) => f.title === "rename the flag")!;
  dismissFinding(ref, nit.id, "  the name matches the API  ");
  expect(readDrafts(ref)!.findings.find((f) => f.id === nit.id)!.dismissed?.reason).toBe("the name matches the API");
  expect(pendingDrafts().get(ref)).toBe(1);

  write();
  expect(pendingDrafts().get(ref)).toBe(1);
  const p = { repo: "o/widgets", number: 4242, title: "widgets" } as PrRow;
  expect(reviewPrompt(p, 2, true)).toContain("- rename the flag (src/a.ts): the name matches the API");
  expect(reviewPrompt(p, 2)).not.toContain("rename the flag");
});

test("undo brings a finding back, and every finding dismissed takes the PR off the board", () => {
  write();
  const ids = readDrafts(ref)!.findings.map((f) => f.id);
  for (const id of ids) dismissFinding(ref, id, "not worth it");
  expect(pendingDrafts().has(ref)).toBe(false);
  dismissFinding(ref, ids[0], null);
  expect(pendingDrafts().get(ref)).toBe(1);
  expect(() => dismissFinding(ref, 99, "x")).toThrow("no such finding");
});
