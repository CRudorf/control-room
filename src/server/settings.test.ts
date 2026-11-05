import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { cleanPatch, KNOWN_PROJECTS, knob, onSettingsChange, saveSettings, SETTINGS, SETTINGS_PATH, tuning } from "./settings";

const original = readFileSync(SETTINGS_PATH, "utf8");
const onDisk = () => JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));

afterEach(() => {
  writeFileSync(SETTINGS_PATH, original);
  for (const k of Object.keys(SETTINGS)) delete (SETTINGS as Record<string, unknown>)[k];
  Object.assign(SETTINGS, JSON.parse(original));
  KNOWN_PROJECTS.splice(0, KNOWN_PROJECTS.length);
});

describe("knobs", () => {
  test("the default until one is saved, then the saved value", () => {
    expect(knob("agents", "reviewRounds")).toBe(3);
    saveSettings({ agents: { reviewRounds: 5 } });
    expect(tuning.reviewRounds()).toBe(5);
    expect(onDisk().agents).toEqual({ reviewRounds: 5 });
  });
  test("a value out of bounds in the file falls back to the default", () => {
    (SETTINGS as Record<string, unknown>).polling = { detectMin: 0, jiraMin: 2.5 };
    expect(tuning.detectMs()).toBe(2 * 60_000);
    expect(tuning.jiraMs()).toBe(10 * 60_000);
  });
  test("a saved default leaves the file, so a later default change reaches it", () => {
    saveSettings({ agents: { reviewRounds: 3, guides: 4 } });
    expect(onDisk().agents).toEqual({ guides: 4 });
    saveSettings({ agents: null });
    expect(onDisk().agents).toBeUndefined();
    expect(tuning.guides()).toBe(2);
  });
});

describe("cleanPatch", () => {
  test("refuses what the page can't set", () => {
    expect(() => cleanPatch({ tracker: { kind: "github", repos: [] } })).toThrow("isn't a setting");
    expect(() => cleanPatch({ polling: { nope: 3 } })).toThrow("no setting nope");
    expect(() => cleanPatch({ agents: { reviewRounds: 11 } })).toThrow("from 1 to 10");
    expect(() => cleanPatch({ agents: { reviewRounds: 2.5 } })).toThrow("whole number");
    expect(() => cleanPatch({ prs: { botPattern: "bot(" } })).toThrow("isn't a valid pattern");
    expect(() => cleanPatch({ flow: { parkRules: [{ note: "x" }] } })).toThrow("needs a status");
    expect(() => cleanPatch({ schedule: { loopFrom: 12, loopUntil: 9 } })).toThrow("must end after it starts");
  });
  test("trims names and drops empties", () => {
    expect(cleanPatch({ jiraProjects: [" ABC ", "", "ABC", "XYZ"], org: "  ", flow: { stages: ["staging", "main"], who: "" } }))
      .toEqual({ jiraProjects: ["ABC", "XYZ"], org: undefined, flow: { stages: ["staging", "main"] } });
  });
});

describe("saveSettings", () => {
  test("keeps the keys the page doesn't edit, and drops the ones it empties", () => {
    writeFileSync(SETTINGS_PATH, JSON.stringify({ org: "acme", repos: { widgets: { reviewers: ["pat"] } } }));
    saveSettings({ org: "", sentryOrg: "acme" });
    expect(onDisk()).toEqual({ sentryOrg: "acme", repos: { widgets: { reviewers: ["pat"] } } });
    expect(SETTINGS.org).toBeUndefined();
  });
  test("rebuilds the known projects in place and tells listeners", () => {
    let told = 0;
    onSettingsChange(() => told++);
    saveSettings({ jiraProjects: ["ABC", "XYZ"] });
    expect(KNOWN_PROJECTS).toEqual(["ABC", "XYZ"]);
    expect(told).toBe(1);
  });
  test("a dry run applies the change and leaves the file alone", () => {
    saveSettings({ org: "acme" }, { dryRun: true });
    expect(SETTINGS.org).toBe("acme");
    expect(readFileSync(SETTINGS_PATH, "utf8")).toBe(original);
  });
  test("a bad patch changes nothing", () => {
    expect(() => saveSettings({ org: "acme", agents: { guides: 99 } })).toThrow();
    expect(SETTINGS.org).toBeUndefined();
    expect(readFileSync(SETTINGS_PATH, "utf8")).toBe(original);
  });
});
