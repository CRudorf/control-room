import { describe, expect, test } from "bun:test";
import { parseSignal, reposFromHistory, taskPrompt } from "./start";

describe("parseSignal", () => {
  test("Jira keys and URLs, Sentry short ids and URLs, PostHog replays", () => {
    expect(parseSignal("ABC-123")).toMatchObject({ kind: "jira", key: "ABC-123" });
    expect(parseSignal("https://example.atlassian.net/browse/ABC-9")).toMatchObject({ kind: "jira", key: "ABC-9" });
    expect(parseSignal("ABC-3-CLIENT-N")).toMatchObject({ kind: "sentry", key: "ABC-3-CLIENT-N" });
    expect(parseSignal("https://acme.sentry.io/issues/4242/?project=1")).toMatchObject({ kind: "sentry", key: "SENTRY-4242" });
    expect(parseSignal("https://us.posthog.com/project/1/replay/0192abcd-ef01-7000")).toMatchObject({ kind: "posthog", key: "replay-0192abcd" });
    expect(parseSignal("")).toBeNull();
  });
  test("anything else is a task, keyed by a key it mentions or its first words", () => {
    expect(parseSignal("add a CSV export to the member report, keep it small")).toMatchObject({ kind: "task", key: "task-add-a-csv-export" });
    expect(parseSignal("tidy the logging around ABC-12 retries")).toMatchObject({ kind: "task", key: "ABC-12" });
    expect(parseSignal("spike")).toMatchObject({ kind: "task", key: "task-spike" });
  });
});

describe("reposFromHistory", () => {
  const facts = [
    { feature: "ABC-1", repo: "acme/widgets", created: "" }, { feature: "ABC-2", repo: "acme/widgets", created: "" },
    { feature: "ABC-3", repo: "acme/gears", created: "" }, { feature: "ABC-3-CLIENT-M", repo: "acme/web", created: "" },
    { feature: "XYZ-1", repo: "acme/other", created: "" },
  ];
  test("a Jira project goes where its PRs went, most first", () => {
    expect(reposFromHistory(parseSignal("ABC-99")!, facts)).toEqual(["widgets", "gears", "web"]);
  });
  test("a Sentry issue goes where that Sentry project's PRs went", () => {
    expect(reposFromHistory(parseSignal("ABC-3-CLIENT-Q")!, facts)).toEqual(["web"]);
  });
});

describe("taskPrompt", () => {
  test("a task goes as written; a done line adds itself and asks for the checks", () => {
    expect(taskPrompt("add a CSV export")).toBe("add a CSV export");
    expect(taskPrompt("add a CSV export", "  ")).toBe("add a CSV export");
    const p = taskPrompt("add a CSV export", "the export downloads with a header row ");
    expect(p).toStartWith("add a CSV export\n\nDone when: the export downloads with a header row\n\n");
    expect(p).toContain("exit code");
  });
});
