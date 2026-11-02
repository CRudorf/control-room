// Drift test: the states in the code and the states in docs/statecharts must agree.
// When a test here fails, update the chart (see docs/statecharts/<name>/) or this table.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config";

/** Code name -> the words the chart uses for it. Edit this table when a name or a label changes. */
export const CHART_LABELS = {
  lane: { mine: "My turn", waiting: "Waiting on others", asked: "Asked of me", parked: "Parked" } as Record<string, string>,
  pickup: { assign: "assign", move: "move to In Progress", agent: "start agent" } as Record<string, string>,
};

const src = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
/** State labels (`sN: label`) and arrow labels (`sA --> sB: label`) of a chart. */
const labels = (mmd: string) => ({
  states: [...mmd.matchAll(/^\s+s\d+: (.+)$/gm)].map((m) => m[1].trim()),
  arrows: [...mmd.matchAll(/-->\s*s\d+: (.+)$/gm)].map((m) => m[1].trim()),
});

describe("statecharts match the code", () => {
  test("every Lane value is a state in the lanes chart", () => {
    const lanes = [...src("src", "shared", "types.ts").match(/export type Lane = ([^;]+);/)![1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(lanes.length).toBeGreaterThan(0);
    const { states } = labels(src("docs", "statecharts", "lanes", "chart.mmd"));
    for (const lane of lanes) {
      const label = CHART_LABELS.lane[lane];
      expect(label, `Lane "${lane}" has no entry in CHART_LABELS.lane`).toBeDefined();
      expect(states.some((s) => s === label || s.startsWith(`${label}:`) || s.startsWith(`${label},`)), `no state "${label}" in lanes/chart.mmd`).toBe(true);
    }
  });

  test("every pickup step is named in the pickup chart", () => {
    const body = src("src", "server", "suggestions.ts").match(/export type PickupSteps = \{([^}]+)\}/)![1];
    const steps = [...body.matchAll(/(\w+)\?:/g)].map((m) => m[1]);
    expect(steps.length).toBeGreaterThan(0);
    const { arrows } = labels(src("docs", "statecharts", "pickup", "chart.mmd"));
    for (const s of steps) {
      const label = CHART_LABELS.pickup[s];
      expect(label, `PickupSteps "${s}" has no entry in CHART_LABELS.pickup`).toBeDefined();
      expect(arrows.some((a) => a.includes(label)), `no arrow names "${label}" in pickup/chart.mmd`).toBe(true);
    }
  });

  test("every chart has its rendered SVG", () => {
    for (const name of ["signal-to-pr", "lanes", "pickup"]) expect(src("docs", "statecharts", name, "chart.svg")).toContain("<svg");
  });
});
