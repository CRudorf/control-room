import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { setAdapter, type Adapter } from "./runner";
import { addFlowChange, chartRun, getVisual, listVisuals, newVisualDir, noFlowChange, parseMeta, VISUALS_DIR, withSection } from "./visuals";

afterEach(() => setAdapter(null));

const meta = (id: string, o: object = {}) => ({ id, kind: "change", title: "T", key: "ABC-1", pr: "acme/w#7", createdAt: "2030-01-01T00:00:00Z", rulesHold: true, files: ["after.svg", "before.mmd", "after.mmd", "diff.md"], ...o });

function put(id: string, m: object, files: Record<string, string> = {}) {
  const dir = join(VISUALS_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(m));
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
}

test("parseMeta keeps a good meta and refuses a bad one", () => {
  expect(parseMeta(JSON.stringify(meta("a1")))).toMatchObject({ id: "a1", kind: "change", rulesHold: true });
  expect(parseMeta("{")).toBeNull();
  expect(parseMeta(JSON.stringify(meta("a1", { kind: "movie" })))).toBeNull();
  expect(parseMeta(JSON.stringify(meta("a1", { files: ["../x"] })))).toBeNull();
  expect(parseMeta(JSON.stringify(meta("a1", { rulesHold: "yes" })))).toBeNull();
});

test("the index has the repo flows and the stored visuals, and filters by key", () => {
  put("v-key", meta("v-key"));
  put("v-other", meta("v-other", { key: "ABC-2" }));
  put("v-bad", { id: "v-bad" });
  const all = listVisuals();
  expect(all.some((v) => v.id === "flow-lanes" && v.kind === "flow" && v.rulesHold === true)).toBe(true);
  expect(all.some((v) => v.id === "v-bad")).toBe(false);
  expect(listVisuals({ key: "abc-1" }).map((v) => v.id)).toEqual(["v-key"]);
  expect(listVisuals({ kind: "flow" }).every((v) => v.kind === "flow")).toBe(true);
});

test("a change with no flow change has no chart and a one-line reason", () => {
  const { id, dir } = newVisualDir("change-w-8");
  const m = noFlowChange(dir, id, { key: "ABC-3", pr: "acme/w#8", reason: "Only a CSS change.\nmore" });
  expect(m).toEqual({ id, kind: "change", title: "No flow change", key: "ABC-3", pr: "acme/w#8", createdAt: m.createdAt, rulesHold: null, files: [], reason: "Only a CSS change." });
  expect(getVisual(id)?.meta).toEqual(m);
});

test("the section replaces itself and keeps the other text", () => {
  const s1 = "<!-- flow-change -->\none\n<!-- /flow-change -->";
  const s2 = "<!-- flow-change -->\ntwo\n<!-- /flow-change -->";
  const once = withSection("Intro.\n\nTests pass.\n", s1);
  expect(once).toBe(`Intro.\n\nTests pass.\n\n${s1}`);
  const twice = withSection(`${once}\n\nFooter.`, s2);
  expect(twice).toBe(`Intro.\n\nTests pass.\n\n${s2}\n\nFooter.`);
  expect(withSection(twice, s2)).toBe(twice);
  expect(withSection("", s1)).toBe(s1);
});

test("the PR body edit goes through runner.write outside dev, and sends nothing in dev", async () => {
  put("v-pr", meta("v-pr"), { "before.mmd": "stateDiagram-v2\n  a --> b", "after.mmd": "stateDiagram-v2\n  a --> c", "diff.md": "Arrow added: a to c" });
  const calls: string[][] = [];
  const adapter: Adapter = async (cmd) => { calls.push(cmd); return { out: cmd[2] === "view" ? "Body.\n" : "", err: "", code: 0 }; };
  setAdapter(adapter, false);
  expect(await addFlowChange({ item: "i", trigger: "detail" }, "v-pr", "acme/w#7")).toBe("done");
  expect(calls.map((c) => c.slice(0, 3))).toEqual([["gh", "pr", "view"], ["gh", "pr", "edit"]]);
  const body = calls[1].at(-1)!;
  expect(body.startsWith("Body.\n\n<!-- flow-change -->")).toBe(true);
  expect(body).toContain("```mermaid\nstateDiagram-v2\n  a --> c\n```");
  const rec = () => db.query<{ action: string; sent: string; dry_run: number }, []>("SELECT action, sent, dry_run FROM action_records ORDER BY id DESC LIMIT 1").get();
  expect(rec()).toEqual({ action: "pr-flow-change", sent: "acme/w#7", dry_run: 0 });
  calls.length = 0;
  setAdapter(adapter, true);
  expect(await addFlowChange({ item: "i", trigger: "detail" }, "v-pr", "acme/w#7")).toBe("dry run");
  expect(calls.map((c) => c[2])).toEqual(["view"]);
  expect(rec()).toEqual({ action: "pr-flow-change", sent: "acme/w#7", dry_run: 1 });
});

test("a chart run: charting while its session works, stalled when it stops, gone with a result", () => {
  const { id, dir } = newVisualDir("change-repo-77");
  const pr = "o/repo#77";
  writeFileSync(join(dir, "charting.json"), JSON.stringify({ pr, agent: "cr-chart-repo-77", at: new Date().toISOString() }));
  const agent = (status: string) => [{ name: "cr-chart-repo-77", pane: "p1", status }];
  expect(chartRun(pr, agent("working"))).toMatchObject({ id, state: "charting", pane: "p1" });
  expect(chartRun(pr, [])?.state).toBe("charting"); // just started: the session list can lag
  const later = Date.now() + 120_000;
  expect(chartRun(pr, agent("working"), later)?.state).toBe("charting");
  expect(chartRun(pr, agent("idle"), later)?.state).toBe("stalled");
  expect(chartRun(pr, [], later)).toMatchObject({ state: "stalled", pane: null });
  expect(chartRun("o/repo#78", agent("working"))).toBeNull();
  writeFileSync(join(dir, "meta.json"), "{}");
  expect(chartRun(pr, agent("working"))).toBeNull();
});

test("the visual added last is the one marked in its PR body", async () => {
  setAdapter(async (cmd) => ({ out: cmd.includes("view") ? "body" : "", err: "", code: 0 }), false);
  const m1 = { ...meta("inpr1"), pr: "o/r#5" }, m2 = { ...meta("inpr2"), pr: "o/r#5" };
  const files = { "before.mmd": "a", "after.mmd": "b" };
  put("inpr1", m1, files); put("inpr2", m2, files);
  const mark = (id: string) => getVisual(id)!.meta.inPrAt;
  expect(mark("inpr1")).toBeUndefined();
  await addFlowChange({ item: null, trigger: "t" }, "inpr1", "o/r#5");
  expect(mark("inpr1")).toBeTruthy();
  await addFlowChange({ item: null, trigger: "t" }, "inpr2", "o/r#5");
  expect(mark("inpr1")).toBeUndefined();
  expect(mark("inpr2")).toBeTruthy();
});
