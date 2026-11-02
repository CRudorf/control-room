import { describe, expect, test } from "bun:test";
import { keysIn, namesFor } from "./artifacts";

describe("artifact keys", () => {
  test("Jira keys and Sentry ids in file names, without reading words as parts of a key", () => {
    expect(keysIn("2030-01-14_ABC-1284_bh-service-election.md")).toEqual(["ABC-1284"]);
    expect(keysIn("ABC-1062-before-main.gif")).toEqual(["ABC-1062"]);
    expect(keysIn("fix ABC-3-CLIENT-N and ABC-9.mp4")).toEqual(["ABC-3-CLIENT-N", "ABC-9"]);
    expect(keysIn("crab_rave.gif")).toEqual([]);
  });
  test("a work item goes by its key, its Sentry tail and its PRs' Jira keys", () => {
    expect(namesFor({ key: "ABC-3-API-1V", prs: [{ title: "ABC-1068: unknown path" }] as any })).toEqual(["ABC-3-API-1V", "API-1V", "ABC-1068"]);
  });
});
