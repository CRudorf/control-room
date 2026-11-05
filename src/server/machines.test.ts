import { describe, expect, test } from "bun:test";
import { onWhich } from "./herdr";
import { onlyHere } from "./routines";
import { cleanPatch } from "./settings";

describe("machines in Settings", () => {
  test("keeps a name, an ssh target and a repos folder; drops the defaults", () => {
    expect(cleanPatch({ machines: [{ name: "box", ssh: "pat@dev-box", reposRoot: "~/Projects", enabled: true }, { name: "spare", ssh: "spare", reposRoot: "/srv/code", enabled: false }] }))
      .toEqual({ machines: [{ name: "box", ssh: "pat@dev-box" }, { name: "spare", ssh: "spare", reposRoot: "/srv/code", enabled: false }] });
    expect(cleanPatch({ machines: [] })).toEqual({ machines: undefined });
  });
  test("refuses a target that ssh would read as an option, and names that clash", () => {
    expect(() => cleanPatch({ machines: [{ name: "box", ssh: "-oProxyCommand=x" }] })).toThrow("user@host");
    expect(() => cleanPatch({ machines: [{ name: "box", ssh: "a@b" }, { name: "box", ssh: "c@d" }] })).toThrow("two machines");
    expect(() => cleanPatch({ machines: [{ name: "Box!", ssh: "a@b" }] })).toThrow("lowercase");
    expect(() => cleanPatch({ machines: [{ name: "box", ssh: "a@b", reposRoot: "$(rm -rf)" }] })).toThrow("repos folder");
  });
});

describe("onWhich", () => {
  test("a machine's pane carries its name; this Mac's doesn't", () => {
    expect(onWhich("box/w1:p2")).toEqual({ machine: "box", id: "w1:p2" });
    expect(onWhich("w1:p2")).toEqual({ machine: null, id: "w1:p2" });
  });
});

describe("onlyHere", () => {
  test("a routine set to this Mac, or one that reads this Mac's sessions, never goes to a machine", () => {
    expect(onlyHere({ runOn: "local" })).toBe(true);
    expect(onlyHere({ brief: "sessions" })).toBe(true);
    expect(onlyHere({})).toBe(false);
  });
});
